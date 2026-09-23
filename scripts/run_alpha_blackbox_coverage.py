"""Run isolated automated checkpoints for all 63 documented alpha cases."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
OUTPUT = ROOT / "test-results" / "alpha-blackbox-contract-evidence.json"


def django(*labels: str) -> tuple[str, ...]:
    return labels


# Added: each document ID maps to focused executable checks already maintained by the project.
# These are isolated API/domain or frontend contract checks; they do not use production data.
CASES: tuple[dict[str, object], ...] = (
    {"id": "TC-01", "module": "Authentication", "title": "Admin or owner valid login", "layer": "Backend contract plus browser UI", "django": django("core.test_auth_trip_feedback_flows.AuthenticationFlowTests.test_valid_staff_credentials_create_token_and_update_last_login")},
    {"id": "TC-02", "module": "Authentication", "title": "Role-based portal redirection", "layer": "Backend contract", "django": django("core.test_auth_trip_feedback_flows.AuthenticationFlowTests.test_generic_staff_login_returns_the_account_role", "core.test_google_oauth_audiences.UnifiedLoginTests.test_password_sign_in_routes_an_existing_customer")},
    {"id": "TC-03", "module": "Authentication", "title": "Invalid login is rejected", "layer": "Backend contract plus browser UI", "django": django("core.test_auth_trip_feedback_flows.AuthenticationFlowTests.test_invalid_staff_password_is_rejected_without_updating_last_login")},
    {"id": "TC-04", "module": "Authentication", "title": "Client registration submission", "layer": "Backend contract plus browser UI", "django": django("core.test_customer_registration_approval.RegistrationIsPendingTests.test_registration_is_received_without_a_session")},
    {"id": "TC-05", "module": "Authentication", "title": "Valid OTP activates client access", "layer": "Backend contract", "django": django("core.test_auth_trip_feedback_flows.AuthenticationFlowTests.test_customer_email_verification_request_and_confirm_issue_token")},
    {"id": "TC-06", "module": "Authentication", "title": "Invalid OTP is rejected", "layer": "Backend contract", "django": django("core.test_auth_trip_feedback_flows.AuthenticationFlowTests.test_login_two_factor_rejects_invalid_otp")},
    {"id": "TC-07", "module": "Authentication", "title": "Owner creates staff or driver credentials", "layer": "Backend contract", "django": django("core.test_user_name_fields.UserCreationNameFieldTests.test_structured_name_parts_are_persisted", "core.test_user_name_fields.UserCreationNameFieldTests.test_driver_service_area_is_saved_during_creation")},
    {"id": "TC-08", "module": "Authentication", "title": "Duplicate email and weak password validation", "layer": "Backend contract", "django": django("core.test_single_warehouse.SingleWarehouseApiContractTests.test_duplicate_email_is_rejected_across_account_types", "core.test_auth_sessions.PasswordPolicyContractTests.test_users_collection_rejects_weak_password")},
    {"id": "TC-09", "module": "Authentication", "title": "Client password reset through OTP", "layer": "Backend contract", "django": django("core.test_auth_trip_feedback_flows.AuthenticationFlowTests.test_password_reset_otp_updates_customer_password")},
    {"id": "TC-10", "module": "Authentication", "title": "Owner resets staff or driver password", "layer": "Backend contract", "django": django("core.test_single_warehouse.SingleWarehouseApiContractTests.test_admin_can_reset_selected_user_password_without_user_otp")},
    {"id": "TC-11", "module": "Profile", "title": "Employee profile updates persist", "layer": "Backend contract", "django": django("core.test_auth_sessions.StaffPhoneValidationContractTests.test_staff_phone_update_persists_valid_philippine_mobile", "core.test_driver_api.DriverProfileApiContractTests.test_driver_profile_put_updates_avatar")},
    {"id": "TC-12", "module": "Profile", "title": "Invalid employee profile data is rejected", "layer": "Backend contract", "django": django("core.test_auth_sessions.StaffPhoneValidationContractTests.test_staff_phone_update_rejects_non_numeric_or_invalid_mobile", "core.test_driver_api.DriverProfileApiContractTests.test_driver_profile_rejects_invalid_phone_and_past_license_expiry")},
    {"id": "TC-13", "module": "Profile", "title": "Driver license profile details are saved", "layer": "Backend contract", "django": django("core.test_driver_api.DriverProfileApiContractTests.test_driver_profile_put_updates_driver_and_user_fields")},
    {"id": "TC-14", "module": "Profile", "title": "Client profile and delivery coordinates are retained", "layer": "Backend contract", "django": django("core.test_customer_orders.CustomerTrackingApiContractTests.test_customer_profile_put_persists_first_and_last_names", "core.test_customer_orders.CustomerOrdersPostApiContractTests.test_customer_orders_post_auto_assigns_nearest_fulfillable_warehouse_when_not_provided")},
    {"id": "TC-15", "module": "Profile", "title": "Unsupported delivery location is rejected", "layer": "Backend contract", "django": django("core.test_driver_service_areas.DriverServiceAreaTests.test_trip_endpoint_rejects_unassigned_destination_without_creating_trip")},
    {"id": "TC-16", "module": "Master Data", "title": "Vehicle records support delivery planning", "layer": "Backend contract", "django": django("core.test_trip_planning.RoutePlanStructureContractTests.test_route_plan_get_returns_drivers_vehicles_orders_and_grouped_plans")},
    {"id": "TC-17", "module": "Master Data", "title": "Duplicate or conflicting vehicle use is prevented", "layer": "Backend contract", "django": django("core.test_trip_execution.TripExecutionApiContractTests.test_trip_start_refuses_second_active_trip_and_leaves_it_planned")},
    {"id": "TC-18", "module": "Master Data", "title": "Driver-to-vehicle assignment is accepted", "layer": "Backend contract", "django": django("core.test_driver_license_qualification.DriverVehicleAssignmentApiTests.test_assigning_code_c_driver_to_truck_succeeds")},
    {"id": "TC-19", "module": "Master Data", "title": "Active-trip assignment conflict is prevented", "layer": "Backend contract", "django": django("core.test_driver_api.DriverVehicleActiveTripValidationTests.test_vehicle_update_rejects_unassignment_during_active_trip")},
    {"id": "TC-20", "module": "Master Data", "title": "Product registration calculates packaging data", "layer": "Backend contract", "django": django("core.test_product_weights.ProductWeightApiContractTests.test_registration_calculates_weight_without_client_value", "core.test_upload_storage.ProductImageUploadTests.test_the_file_bytes_are_sent_to_the_bucket")},
    {"id": "TC-21", "module": "Master Data", "title": "Invalid product specifications are rejected", "layer": "Backend contract", "django": django("core.test_product_weights.ProductWeightApiContractTests.test_registration_rejects_product_when_weight_cannot_be_calculated")},
    {"id": "TC-22", "module": "Inventory", "title": "Stock batch receiving records inventory movement", "layer": "Backend contract", "django": django("core.test_warehouse_inventory.BulkStockInExistingProductContractTests.test_retry_does_not_duplicate_quantity_or_product", "core.test_stock_batch_transaction_sync.StockBatchTransactionSyncTests.test_edit_preserves_stock_in_transaction_and_appends_adjustments")},
    {"id": "TC-23", "module": "Inventory", "title": "Expired or invalid stock receipt is rejected", "layer": "Backend contract", "django": django("core.test_warehouse_inventory.BulkStockInExistingProductContractTests.test_bulk_stock_in_rejects_past_expiry_date", "core.test_mixed_case_backend_guards.MixedCaseBackendGuardTests.test_product_opening_stock_is_batch_backed_and_fractional_stock_is_rejected")},
    {"id": "TC-24", "module": "Inventory", "title": "Inventory transaction history is scoped and auditable", "layer": "Backend contract", "django": django("core.test_warehouse_inventory.WarehouseStaffInventoryScopeContractTests.test_inventory_transactions_endpoint_for_warehouse_staff_returns_only_assigned_warehouse_transactions")},
    {"id": "TC-25", "module": "Inventory", "title": "Inventory thresholds and stock health update", "layer": "Backend contract", "django": django("core.test_inventory_alerts.InventoryStockAlertTests.test_reorder_and_out_of_stock_transitions_notify_admin_and_warehouse_staff")},
    {"id": "TC-26", "module": "Inventory", "title": "Negative or invalid stock quantity is prevented", "layer": "Backend contract", "django": django("core.test_stock_batch_transaction_sync.StockBatchTransactionSyncTests.test_batch_increase_cannot_exceed_warehouse_capacity", "core.test_mixed_case_backend_guards.MixedCaseBackendGuardTests.test_inventory_adjustments_are_ledgered_and_keep_reserved_counters_nonnegative")},
    {"id": "TC-27", "module": "Orders", "title": "Client order is created", "layer": "Backend contract", "django": django("core.test_customer_orders.CustomerOrdersApiContractTests.test_customer_order_create_defaults_to_pending")},
    {"id": "TC-28", "module": "Orders", "title": "Mixed case is priced and processed", "layer": "Backend contract", "django": django("core.test_mixed_case.MixedCaseApiTests.test_checkout_is_server_priced_and_idempotent")},
    {"id": "TC-29", "module": "Orders", "title": "Checkout cannot exceed available stock", "layer": "Backend contract", "django": django("core.test_customer_orders.CustomerOrdersPostApiContractTests.test_large_insufficient_request_remains_visible_without_over_reserving")},
    {"id": "TC-30", "module": "Orders", "title": "Limited stock cannot be fulfilled twice", "layer": "Backend contract", "django": django("core.test_customer_orders.CustomerOrdersPostApiContractTests.test_second_purchase_request_submission_does_not_overbook_reserved_stock")},
    {"id": "TC-31", "module": "Orders", "title": "Warehouse order queue returns scoped details", "layer": "Backend contract", "django": django("core.test_warehouse_inventory.WarehouseStaffInventoryScopeContractTests.test_orders_endpoint_for_warehouse_staff_returns_only_assigned_warehouse_orders", "core.test_order_workflow.PaginationGuardsContractTests.test_orders_include_returns_always_exposes_customer_display_name")},
    {"id": "TC-32", "module": "Orders", "title": "Purchase order advances to preparation", "layer": "Backend contract", "django": django("core.test_order_workflow.PurchaseRequestWorkflowTests.test_warehouse_approval_creates_purchase_order_metadata", "core.test_order_workflow.OrderStatusTransitionApiContractTests.test_preparing_status_updates_order_and_timeline")},
    {"id": "TC-33", "module": "Transportation", "title": "Trip management data is available", "layer": "Backend contract", "django": django("core.test_trip_planning.RoutePlanStructureContractTests.test_route_plan_get_returns_drivers_vehicles_orders_and_grouped_plans")},
    {"id": "TC-34", "module": "Transportation", "title": "Delivery trip is created with stops", "layer": "Backend contract", "django": django("core.test_trip_planning.TripsPostCreationContractTests.test_trips_post_creates_trip_with_drop_points_and_total_count")},
    {"id": "TC-35", "module": "Transportation", "title": "Vehicle load capacity is validated", "layer": "Backend contract", "django": django("core.test_trip_planning.TripsPostCreationContractTests.test_trips_post_rejects_vehicle_overload_and_reports_excess_weight")},
    {"id": "TC-36", "module": "Transportation", "title": "Camera and location capture metadata is validated", "layer": "Backend contract", "django": django("core.test_pod_overlay.PodOverlayTests.test_parses_valid_capture_metadata", "core.test_upload_endpoints.UploadEndpointsAuthContractTests.test_upload_pod_image_requires_driver_role")},
    {"id": "TC-37", "module": "Transportation", "title": "Trip starts and GPS updates are accepted", "layer": "Backend contract", "django": django("core.test_trip_execution.TripExecutionApiContractTests.test_trip_start_sets_in_progress_and_actual_start_at", "core.test_driver_api.DriverLocationAccuracyContractTests.test_degraded_but_usable_gps_sample_updates_the_driver_location")},
    {"id": "TC-38", "module": "Transportation", "title": "Proof of delivery image contains capture overlay", "layer": "Backend contract", "django": django("core.test_pod_overlay.PodOverlayTests.test_burns_overlay_into_readable_jpeg")},
    {"id": "TC-39", "module": "Transportation", "title": "Live driver location uses the latest valid fix", "layer": "Backend contract", "django": django("core.test_trip_planning.TripsCollectionTrackingContractTests.test_trips_collection_include_tracking_and_date_filter", "core.test_driver_api.DriverLocationAccuracyContractTests.test_inaccurate_sample_cannot_overwrite_reliable_driver_location")},
    {"id": "TC-40", "module": "Transportation", "title": "Client delivery tracking and POD are exposed", "layer": "Backend contract", "django": django("core.test_customer_orders.CustomerTrackingApiContractTests.test_customer_tracking_returns_status_and_order_status_for_compatibility", "core.test_customer_orders.CustomerOrdersApiContractTests.test_customer_orders_falls_back_to_completed_stop_pod_photo")},
    {"id": "TC-41", "module": "Transportation", "title": "Pending trip can be cancelled safely", "layer": "Backend contract", "django": django("core.test_trip_planning.RoutePlanStructureContractTests.test_trip_delete_rejects_non_planned_trip")},
    {"id": "TC-42", "module": "Replacements", "title": "Client submits a replacement claim with evidence", "layer": "Backend contract", "django": django("core.test_replacements.CustomerReplacementRequestContractTests.test_claim_stores_exactly_the_evidence_it_was_sent")},
    {"id": "TC-43", "module": "Replacements", "title": "Replacement claim requires valid evidence", "layer": "Backend contract", "django": django("core.test_prelaunch_access_guards.PrelaunchRemainingSecurityTests.test_invalid_images_rejected_and_upload_names_do_not_collide")},
    {"id": "TC-44", "module": "Replacements", "title": "Replacement quantity is capped", "layer": "Backend contract", "django": django("core.test_mixed_case_backend_guards.MixedCaseBackendGuardTests.test_standard_replacement_cap_uses_server_capacity_and_rejects_fractional_quantity")},
    {"id": "TC-45", "module": "Replacements", "title": "Warehouse replacement list is scoped", "layer": "Backend contract", "django": django("core.test_warehouse_inventory.WarehouseStaffInventoryScopeContractTests.test_replacements_endpoint_for_warehouse_staff_returns_only_assigned_warehouse_replacements")},
    {"id": "TC-46", "module": "Replacements", "title": "Replacement details include claim evidence", "layer": "Backend contract", "django": django("core.test_replacements.CustomerReplacementRequestContractTests.test_completed_replacement_serializes_linked_order_pod")},
    {"id": "TC-47", "module": "Replacements", "title": "Verified replacement enters processing", "layer": "Backend contract", "django": django("core.test_replacements.WarehouseReplacementProcessingContractTests.test_warehouse_starts_processing_before_scheduling_replacement")},
    {"id": "TC-48", "module": "Replacements", "title": "Replacement rejection state is enforced", "layer": "Backend contract", "django": django("core.test_replacements.CustomerReplacementRequestContractTests.test_customer_replacement_request_rejects_if_previous_replacement_was_rejected")},
    {"id": "TC-49", "module": "Replacements", "title": "Replacement redelivery is scheduled", "layer": "Backend contract", "django": django("core.test_replacements.WarehouseReplacementRescheduleContractTests.test_past_due_replacement_delivery_moves_to_the_new_date")},
    {"id": "TC-50", "module": "Replacements", "title": "Replacement redelivery completes with POD", "layer": "Backend contract", "django": django("core.test_order_workflow.DeliveryLifecycleFlowContractTests.test_delivery_lifecycle_end_to_end", "core.test_replacements.CustomerReplacementRequestContractTests.test_completed_replacement_serializes_linked_order_pod")},
    {"id": "TC-51", "module": "Feedback", "title": "Client rating and category feedback is saved", "layer": "Backend contract", "django": django("core.test_auth_trip_feedback_flows.FeedbackFlowTests.test_completed_order_feedback_is_persisted", "core.test_notifications_feedback.FeedbackDescribedReasonTests.test_other_reason_is_stored_verbatim")},
    {"id": "TC-52", "module": "Feedback", "title": "Duplicate order feedback is prevented", "layer": "Backend contract", "django": django("core.test_auth_trip_feedback_flows.FeedbackFlowTests.test_duplicate_feedback_for_the_same_order_is_rejected")},
    {"id": "TC-53", "module": "Feedback", "title": "Feedback KPIs and rating distribution are calculated", "layer": "Frontend contract", "node": ("feedback KPI totals and period deltas come from one row set", "dimension breakdown returns every bucket and counts each review once per dimension")},
    {"id": "TC-54", "module": "Feedback", "title": "Feedback ratings map to filterable dimensions", "layer": "Frontend contract", "node": ("every rating option in the shared catalogs maps to a known service dimension", "feedback messages parse into reasons and map onto service dimensions")},
    {"id": "TC-55", "module": "Reports", "title": "Report access and module loading", "layer": "Frontend contract", "node": ("report identity supports backend staff sessions and existing client profiles", "opening Reports avoids unrelated requests, reuses orders, and refreshes invalidated tabs")},
    {"id": "TC-56", "module": "Reports", "title": "Retail sales filters and KPIs", "layer": "Frontend contract", "node": ("date presets cover exactly the number of days they name", "every tab recognises revenue on delivery and only on delivery")},
    {"id": "TC-57", "module": "Reports", "title": "Transportation performance report and PDF", "layer": "Frontend contract", "node": ("active trip counting uses normalized trip statuses", "PDF retains rows, columns and long cell values across pages")},
    {"id": "TC-58", "module": "Reports", "title": "Inventory movement report and PDF", "layer": "Frontend contract", "node": ("inventory movement selectors keep only in and out and chart totals match row totals", "PDF retains rows, columns and long cell values across pages")},
    {"id": "TC-59", "module": "Reports", "title": "Replacement report sources and filters", "layer": "Frontend contract", "node": ("report dependencies include the sources used by charts and exports", "date presets cover exactly the number of days they name")},
    {"id": "TC-60", "module": "Reports", "title": "Feedback satisfaction report and PDF", "layer": "Frontend contract", "node": ("feedback KPI totals and period deltas come from one row set", "PDF retains rows, columns and long cell values across pages")},
    {"id": "TC-61", "module": "Reports", "title": "CSV export preserves structured records", "layer": "Frontend contract", "node": ("CSV export includes headers, escaped values and every row",)},
    {"id": "TC-62", "module": "Reports", "title": "PDF export preserves printable layout", "layer": "Frontend contract", "node": ("PDF retains rows, columns and long cell values across pages", "PDF column cleanup removes redundant purchase document fields")},
    {"id": "TC-63", "module": "Reports", "title": "Empty export does not create a file", "layer": "Frontend contract", "node": ("empty CSV export does not create a download",)},
)


NODE_FILES = (
    "src/lib/report-metrics.test.ts",
    "src/components/portals/admin/sections/reports/export-utils.test.ts",
    "src/components/portals/admin/sections/reports/report-data-plan.test.ts",
)


def run(command: list[str], cwd: Path) -> tuple[int, str]:
    completed = subprocess.run(
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    return completed.returncode, completed.stdout


def main() -> int:
    django_labels = sorted({label for case in CASES for label in case.get("django", ())})
    django_command = [
        sys.executable,
        "manage.py",
        "test",
        *django_labels,
        "--settings=config.settings_case_runner",
        "--verbosity=2",
    ]
    django_code, django_output = run(django_command, BACKEND)

    node_command = ["node", "--experimental-strip-types", "--test", *NODE_FILES, "--test-reporter=spec"]
    node_code, node_output = run(node_command, ROOT)
    # Node enables color when Playwright sets FORCE_COLOR; normalize it for stable evidence parsing.
    node_output = re.sub(r"\x1b\[[0-9;]*m", "", node_output)

    records: list[dict[str, object]] = []
    for case in CASES:
        observed: list[str] = []
        checks = [*case.get("django", ()), *case.get("node", ())]
        passed = True
        django_lines = django_output.splitlines()
        for label in case.get("django", ()):
            method = str(label).rsplit(".", 1)[-1]
            match_index = next((index for index, line in enumerate(django_lines) if method in line and " ... " in line), -1)
            line = django_lines[match_index].strip() if match_index >= 0 else ""
            # Django logging can be emitted between the test label and its final "ok" marker.
            trailing = [part.strip() for part in django_lines[match_index:match_index + 4]] if match_index >= 0 else []
            status_ok = line.endswith("ok") or "ok" in trailing[1:]
            observed.append(f"{line} ... ok" if status_ok and not line.endswith("ok") else (line or f"Missing Django result for {label}"))
            passed = passed and status_ok
        for name in case.get("node", ()):
            line = next((line.strip() for line in node_output.splitlines() if str(name) in line), "")
            observed.append(line or f"Missing Node result for {name}")
            passed = passed and node_code == 0 and bool(line) and "✔" in line
        records.append({
            "id": case["id"],
            "title": case["title"],
            "module": case["module"],
            "layer": case["layer"],
            "result": "Pass" if passed else "Fail",
            "checks": checks,
            "observed": observed,
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "database": "Django in-memory SQLite via config.settings_case_runner",
        "djangoExitCode": django_code,
        "nodeExitCode": node_code,
        "cases": records,
    }, indent=2), encoding="utf-8")

    failures = [record for record in records if record["result"] != "Pass"]
    print(f"Alpha black-box automated checkpoints: {len(records) - len(failures)}/{len(records)} passed")
    for failure in failures:
        detail = "; ".join(failure["observed"]).encode(sys.stdout.encoding or "utf-8", errors="replace").decode(sys.stdout.encoding or "utf-8")
        print(f"FAIL {failure['id']}: {detail}")
    return 1 if failures or django_code or node_code else 0


if __name__ == "__main__":
    raise SystemExit(main())
