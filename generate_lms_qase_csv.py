# -*- coding: utf-8 -*-
"""
Full Generator for LMS_CFM Qase.io Test Cases CSV.
Ensures 100% completeness and 1:1:1 alignment between actions, results, and data for every test case.
Based on LMS_CFM Final Paper (Use Cases 1 to 9) and Capstone System Features.
"""
import csv

headers = [
    'id', 'title', 'description', 'preconditions', 'postconditions', 'tags',
    'priority', 'severity', 'type', 'behavior', 'automation', 'status',
    'is_flaky', 'layer', 'steps_type', 'steps_actions', 'steps_result',
    'steps_data', 'milestone_id', 'milestone', 'suite_id', 'suite_parent_id',
    'suite', 'suite_without_cases', 'parameters', 'is_muted'
]

suites = [
    (1, "Use Case 1: Authentication"),
    (2, "Use Case 2: Profile Management"),
    (3, "Use Case 3: Master Data Management"),
    (4, "Use Case 4: Inventory Management"),
    (5, "Use Case 5: Order Fulfillment & Processing"),
    (6, "Use Case 6: Transportation Management"),
    (7, "Use Case 7: Replacement Handling Management"),
    (8, "Use Case 8: Feedback Management"),
    (9, "Use Case 9: Report Generation")
]

suite_rows = []
for s_id, s_name in suites:
    suite_rows.append({
        'id': '',
        'title': '',
        'description': '',
        'preconditions': '',
        'postconditions': '',
        'tags': '',
        'priority': '',
        'severity': '',
        'type': '',
        'behavior': '',
        'automation': '',
        'status': '',
        'is_flaky': '',
        'layer': '',
        'steps_type': '',
        'steps_actions': '',
        'steps_result': '',
        'steps_data': '',
        'milestone_id': '',
        'milestone': '',
        'suite_id': s_id,
        'suite_parent_id': '',
        'suite': s_name,
        'suite_without_cases': 1,
        'parameters': '',
        'is_muted': ''
    })

test_cases = []

def create_tc(tc_id, title, desc, pre, post, tags, priority, severity, tc_type, behavior, automation, status, is_flaky, layer, step_tuples, suite_id, suite_name, milestone="LMS_CFM v1.0 Release", milestone_id=1, is_muted="no"):
    actions = [f"{i+1}. {s[0]}" for i, s in enumerate(step_tuples)]
    results = [f"{i+1}. {s[1]}" for i, s in enumerate(step_tuples)]
    data = [f"{i+1}. {s[2]}" for i, s in enumerate(step_tuples)]
    
    formatted_actions = "\n".join(actions) + "\n"
    formatted_results = "\n".join(results) + "\n"
    formatted_data = "\n".join(data) + "\n"
    
    test_cases.append({
        'id': tc_id,
        'title': title,
        'description': desc,
        'preconditions': pre,
        'postconditions': post,
        'tags': tags,
        'priority': priority,
        'severity': severity,
        'type': tc_type,
        'behavior': behavior,
        'automation': automation,
        'status': status,
        'is_flaky': is_flaky,
        'layer': layer,
        'steps_type': 'classic',
        'steps_actions': formatted_actions,
        'steps_result': formatted_results,
        'steps_data': formatted_data,
        'milestone_id': milestone_id,
        'milestone': milestone,
        'suite_id': suite_id,
        'suite_parent_id': '',
        'suite': suite_name,
        'suite_without_cases': '',
        'parameters': '',
        'is_muted': is_muted
    })

# ==========================================
# SUITE 1: Use Case 1: Authentication (10 Test Cases)
# ==========================================
create_tc(
    1,
    "TC-01: Admin / Owner Login with Valid Credentials",
    "Verify that the Owner/Admin can successfully log into the LMS_CFM system with valid credentials and is redirected to the Admin Portal dashboard.",
    "The system is running and accessible. Active Owner/Admin account exists in the database.",
    "User session is established, JWT tokens stored, and user is on the Admin Dashboard (/admin).",
    "auth,login,admin,smoke",
    "critical", "blocker", "smoke", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to the application login page (/login/admin or /login).",
         "Login interface is displayed with role selection, email, and password fields.",
         "URL: http://localhost:3000/login/admin"),
        ("Enter registered Owner/Admin email/username and password.",
         "Input fields accept credentials without formatting errors.",
         "Email: admin@coldfoodmovement.com, Password: AdminSecurePassword2026!"),
        ("Click the 'Sign In' button.",
         "System validates credentials against database, issues JWT session token, and returns 200 OK.",
         "Action: Click 'Sign In' button"),
        ("Observe the redirection and dashboard interface.",
         "User is redirected to Admin Portal (/admin) with master data, trips, inventory, replacements, feedback, and reports modules loaded.",
         "Expected Route: /admin")
    ],
    1, "Use Case 1: Authentication"
)

create_tc(
    2,
    "TC-02: Role-Based Redirection for Warehouse Staff, Driver, and Client Portals",
    "Verify that users with different roles (Warehouse Staff, Driver, Client) are redirected to their respective role-specific portals upon successful authentication.",
    "Active accounts for Warehouse Staff, Driver, and verified Client exist in the system.",
    "Each user role lands on their dedicated portal with proper permission scoping.",
    "auth,roles,rbac,navigation",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Log in using Warehouse Staff credentials on the warehouse login page.",
         "Warehouse Staff credentials successfully verified; system creates session and redirects user to /warehouse.",
         "Email: warehouse@lms.local, Password: WarehousePass123!"),
        ("Verify warehouse-specific widgets and navigation tabs in Warehouse Portal.",
         "Warehouse Portal displays inventory batch receiving, stock staging, and trip dispatch checklists.",
         "Route: /warehouse"),
        ("Log out and log in using Driver credentials on the driver login page.",
         "Driver credentials verified; user redirected to mobile-optimized Driver Portal (/driver).",
         "Email: driver.juan@lms.local, Password: DriverPass123!"),
        ("Verify driver navigation map and active delivery trip tab.",
         "Driver Portal renders assigned trips, GPS navigation map, and cold-chain temperature checklist.",
         "Route: /driver"),
        ("Log out and log in using Client/Customer credentials on customer login page.",
         "Client credentials verified; user redirected to Customer Portal (/customer).",
         "Email: store.bistro@client.ph, Password: ClientPass123!"),
        ("Verify client shopping catalog, cart, and delivery tracking tabs.",
         "Customer Portal renders beverage catalog, mixed case builder, order history, and feedback section.",
         "Route: /customer")
    ],
    1, "Use Case 1: Authentication"
)

create_tc(
    3,
    "TC-03: Login Failure with Invalid Credentials or Unregistered Account",
    "Verify that the system denies access and displays an appropriate error message when invalid credentials or nonexistent accounts are used.",
    "The system is running and accessible.",
    "User remains unauthenticated on the login page; no session token is issued.",
    "auth,negative,security,login",
    "high", "major", "security", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to the login page (/login).",
         "Login screen is displayed with email and password inputs.",
         "URL: /login"),
        ("Enter an unregistered email address and arbitrary password.",
         "Input fields accept entered text without browser crash.",
         "Email: fakeuser@unknown.com, Password: WrongPassword123!"),
        ("Click the 'Sign In' button and observe system response.",
         "System returns error: 'Invalid email or password'. User remains unauthenticated.",
         "Action: Click 'Sign In'"),
        ("Enter a valid registered email with an incorrect password.",
         "Inputs accept modified password string.",
         "Email: admin@coldfoodmovement.com, Password: IncorrectPassword!"),
        ("Click 'Sign In' and observe security response.",
         "System rejects login attempt with generic error feedback, protecting against user enumeration.",
         "Action: Click 'Sign In'")
    ],
    1, "Use Case 1: Authentication"
)

create_tc(
    4,
    "TC-04: Client Registration Submission and OTP / Confirmation Generation",
    "Verify that a new Client can fill in the registration form and the system creates a pending account and sends an OTP/email confirmation.",
    "The system is running. Client does not have an existing account.",
    "A pending Client record is created in the database and an OTP verification code is generated.",
    "auth,registration,client,otp",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to the Client registration page (/login/customer or register tab).",
         "Registration form renders with business name, contact person, phone, email, address, and password fields.",
         "URL: /login/customer"),
        ("Fill in all required business and contact details.",
         "Form inputs populate cleanly and validate syntax in real time.",
         "Business: 'Bacolod Fresh Mart', Contact: 'Maria Santos', Phone: '09171234567', Email: 'maria.santos@bacolodmart.ph', Address: 'Lacson St, Bacolod City', Password: 'ClientPassword2026!'"),
        ("Click the 'Register' / 'Sign Up' button.",
         "System creates pending user and customer record in database with status 'pending_verification'.",
         "Action: Click 'Register'"),
        ("Verify system transition to OTP/email confirmation dialog.",
         "OTP code is generated/dispatched, and modal prompt appears: 'Enter the 6-digit confirmation code sent to your email/phone.'",
         "Expected: OTP Entry Modal is visible")
    ],
    1, "Use Case 1: Authentication"
)

create_tc(
    5,
    "TC-05: Client Account Activation via Valid OTP Confirmation Code",
    "Verify that entering the correct OTP confirmation code successfully verifies the Client account and enables full login access.",
    "Pending Client registration exists with a valid unexpired OTP generated.",
    "Client account status is updated to 'verified' / 'active', allowing instant sign-in.",
    "auth,registration,otp,activation",
    "critical", "blocker", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("On the OTP confirmation modal, enter the valid 6-digit OTP code received.",
         "OTP input boxes receive the 6-digit numerical code.",
         "OTP Code: 582914"),
        ("Click 'Verify Code' or 'Confirm Account'.",
         "System validates OTP against backend cache/database record within expiration window.",
         "Action: Click 'Verify Code'"),
        ("Observe account activation and dashboard redirect.",
         "Account status updated to active; success alert displayed: 'Account verified successfully!'. User is authenticated into Customer Portal (/customer).",
         "Expected Route: /customer")
    ],
    1, "Use Case 1: Authentication"
)

create_tc(
    6,
    "TC-06: Client Registration Failure on Expired or Incorrect OTP Code",
    "Verify that submitting an invalid or expired OTP code prevents account activation and prompts for resend.",
    "Pending Client registration exists; invalid OTP or expired code used.",
    "Client account remains in pending state; no access granted.",
    "auth,registration,negative,otp",
    "high", "major", "boundary", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("On the OTP confirmation modal, enter an incorrect 6-digit code.",
         "Input fields populate with incorrect digits.",
         "Invalid OTP: 000000"),
        ("Click 'Verify Code' and check error message.",
         "System displays error: 'Invalid verification code. Please check and try again.' Account remains unverified.",
         "Action: Click 'Verify Code'"),
        ("Click 'Resend Code' button to request a fresh OTP.",
         "Resend request processed; rate-limiting timer (60s) starts.",
         "Action: Click 'Resend Code'"),
        ("Verify dispatch notification of newly generated OTP.",
         "New OTP generated and sent; toast notification confirms new OTP dispatch.",
         "Expected: Toast 'New confirmation code sent'")
    ],
    1, "Use Case 1: Authentication"
)

create_tc(
    7,
    "TC-07: Owner Creates and Manages Staff / Driver Credentials",
    "Verify that the Owner can create new user credentials for Warehouse Staff and Drivers and modify existing employee account credentials.",
    "Owner is logged in with administrative privileges. Staff/Driver management section accessible.",
    "New staff/driver user record created with hashed password and designated system role.",
    "auth,admin,credentials,staff,driver",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Owner navigates to Admin Portal > User Management (/admin/users).",
         "Staff and user management table loads with list of active accounts.",
         "Nav: /admin/users"),
        ("Click 'Add New Employee / Driver'.",
         "Create employee modal opens with name, email, contact, role selector, and password fields.",
         "Action: Click 'Add New Employee'"),
        ("Enter full name, email, contact number, role (Driver), and temporary password.",
         "Form fields validate input format.",
         "Data: Name: 'Carlos Mendoza', Email: 'carlos.driver@lms.local', Role: 'Driver', Phone: '09189876543', Temp Pass: 'DriverInit2026!'"),
        ("Click 'Save Credentials'.",
         "System validates uniqueness of email, creates User record with role 'driver', and displays 'Employee credentials created successfully'.",
         "Action: Click 'Save Credentials'"),
        ("Verify that the new user is listed and can log in.",
         "Carlos Mendoza appears in active drivers table with status 'Active'.",
         "Expected: User row in /admin/users table")
    ],
    1, "Use Case 1: Authentication"
)

create_tc(
    8,
    "TC-08: Credential Validation on Duplicate Email or Weak Password",
    "Verify that the system rejects employee or user creation when using an existing registered email or a password that does not meet complexity standards.",
    "Owner is logged into Admin Portal; user with email 'carlos.driver@lms.local' already exists.",
    "System blocks duplicate entry and weak password submission; database remains unchanged.",
    "auth,validation,negative,security",
    "high", "normal", "security", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("Open 'Add Employee' modal in Admin Portal.",
         "Employee registration form displayed.",
         "Nav: /admin/users -> Add Employee"),
        ("Enter an already existing email address.",
         "Email input field populated with duplicate string.",
         "Email: carlos.driver@lms.local (Duplicate)"),
        ("Enter a short/weak password (e.g. '123').",
         "Password input field populated with short string.",
         "Password: 123 (Weak)"),
        ("Click 'Save Credentials' and inspect field-level validations.",
         "System blocks submission: 'A user with this email already exists' and 'Password must be at least 8 characters long with numbers'.",
         "Action: Click 'Save Credentials'")
    ],
    1, "Use Case 1: Authentication"
)

create_tc(
    9,
    "TC-09: Client Self-Service Password Reset via OTP / Email Verification",
    "Verify that a Client who forgot their password can request a reset code, verify their identity via OTP, and define a new password.",
    "Registered Client account exists. Forgot password feature accessible on login page.",
    "Client password hash is updated in database; user can log in with new password.",
    "auth,password-reset,otp,client",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Click 'Forgot Password?' link on Client login page.",
         "Forgot password dialog appears prompting for registered email address.",
         "URL: /login/customer -> Forgot Password"),
        ("Enter registered Client email address and click 'Send Reset OTP'.",
         "System verifies registered email in database and sends 6-digit OTP reset token.",
         "Email: maria.santos@bacolodmart.ph"),
        ("Enter received 6-digit reset code in OTP confirmation step.",
         "OTP input field accepts code and backend confirms validity.",
         "OTP Code: 941028"),
        ("Enter new password and confirm password, then click 'Update Password'.",
         "System validates password matching, hashes new password, and updates database record with confirmation toast 'Password reset successfully'.",
         "New Password: NewClientSecurePass2026!, Confirm: NewClientSecurePass2026!"),
        ("Log in on customer portal with the updated password.",
         "User successfully authenticates into Customer Portal (/customer) using the new password.",
         "Credentials: maria.santos@bacolodmart.ph / NewClientSecurePass2026!")
    ],
    1, "Use Case 1: Authentication"
)

create_tc(
    10,
    "TC-10: Owner Force Password Reset / Update for Staff or Driver Account",
    "Verify that the Owner can directly reset or change the password for any staff or driver account from the Admin management portal.",
    "Owner is logged into Admin Portal. Staff/driver accounts exist in the system.",
    "Selected employee's password is reset and updated in the database.",
    "auth,admin,password-reset,staff",
    "medium", "normal", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > User Management (/admin/users).",
         "User management table lists all employees and drivers.",
         "Nav: /admin/users"),
        ("Select target Driver/Staff member and click 'Reset Password' action.",
         "Password reset modal opens for the selected employee.",
         "Target User: Carlos Mendoza (Driver)"),
        ("Enter new temporary password and confirm.",
         "Modal inputs receive new valid password string.",
         "New Temp Password: TempDriverPass2026#"),
        ("Click 'Save Password Change'.",
         "Password successfully updated in database; audit log records credential modification by Owner.",
         "Action: Click 'Save Password Change'"),
        ("Test logging in with the staff account using the newly assigned password.",
         "Staff member logs in successfully on /login/driver using the new credentials.",
         "Driver Login: carlos.driver@lms.local / TempDriverPass2026#")
    ],
    1, "Use Case 1: Authentication"
)

# ==========================================
# SUITE 2: Use Case 2: Profile Management (6 Test Cases)
# ==========================================
create_tc(
    11,
    "TC-11: Manage and Update Employee Profile (Owner / Warehouse Staff / Driver)",
    "Verify that an employee (Owner, Warehouse Staff, Driver) can view and update their personal profile details (first name, last name, phone number, avatar image).",
    "Employee is authenticated and on their respective portal.",
    "Employee profile record is updated in the database and reflected in the user interface header and profile page.",
    "profile,employee,avatar,update",
    "high", "normal", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to the Profile Settings page.",
         "Profile page renders current user details, contact info, and profile avatar correctly.",
         "Nav: /profile/settings"),
        ("Inspect existing pre-populated profile information.",
         "All current fields match active database user record.",
         "Data: First Name: 'Juan', Last Name: 'Perez', Phone: '09181112233'"),
        ("Update phone number and select a new profile avatar photo.",
         "Avatar crop dialog appears; photo cropped and real-time preview updated.",
         "New Phone: '09198765432', File: driver_avatar.jpg"),
        ("Click 'Save Profile Changes'.",
         "System validates and saves updated fields; displays toast 'Profile updated successfully'.",
         "Action: Click 'Save Profile Changes'"),
        ("Refresh the page and verify persistence.",
         "Updated phone number and new avatar persist across page reloads and portal header.",
         "Expected: New phone and avatar displayed")
    ],
    2, "Use Case 2: Profile Management"
)

create_tc(
    12,
    "TC-12: Employee Profile Validation on Invalid Phone or Email Format",
    "Verify that invalid input formats (e.g., non-numeric phone number, invalid email structure) are rejected during employee profile updates.",
    "Employee is logged in and on the profile edit form.",
    "Profile update is blocked; invalid fields are highlighted with descriptive error text.",
    "profile,negative,validation",
    "medium", "minor", "functional", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("On profile edit screen, clear phone field and enter an invalid string.",
         "Phone input accepts text with validation indicator.",
         "Phone: ABC12345 (Invalid)"),
        ("Enter an invalid email syntax in email field.",
         "Email input field displays formatting error.",
         "Email: user@.com (Invalid)"),
        ("Click 'Save Profile Changes'.",
         "System blocks submission with error messages: 'Please enter a valid Philippine mobile number (09XXXXXXXXX)' and 'Invalid email address'.",
         "Action: Click 'Save Profile Changes'"),
        ("Verify that profile data in database remains unchanged.",
         "Database record retains original valid phone and email values.",
         "Expected: Original profile data unchanged")
    ],
    2, "Use Case 2: Profile Management"
)

create_tc(
    13,
    "TC-13: Driver License Details and Document Image Upload",
    "Verify that a Driver can submit their driver's license number, license expiration date, restriction codes, and upload a clear license image document.",
    "Driver is logged into Driver Portal; profile/documents section is accessible.",
    "License details and uploaded document file are saved to the Driver record and accessible to Owner for compliance verification.",
    "profile,driver,license,upload,compliance",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Driver Portal > License & Document Management.",
         "License upload section displayed with existing license status.",
         "Nav: /driver/profile/license"),
        ("Enter License Number, Expiration Date, and License Restriction Code.",
         "Form inputs populate with license metadata.",
         "License No: 'N02-18-987654', Expiration: '2028-11-15', Restrictions: '1, 2, 3 (Light/Heavy Commercial)'"),
        ("Upload scanned image/photo of driver's license (JPEG/PNG).",
         "Image file selected and validated against format/size constraints (under 5MB).",
         "File: driver_license_card.png (1.2 MB)"),
        ("Click 'Submit License Details'.",
         "System uploads document to media storage, links URL to Driver profile, and displays 'License details submitted successfully'.",
         "Action: Click 'Submit License Details'"),
        ("Verify license status badge.",
         "Document preview thumbnail displays image with status badge 'Verified' / 'Active'.",
         "Expected: Status badge 'Active'")
    ],
    2, "Use Case 2: Profile Management"
)

create_tc(
    14,
    "TC-14: Driver License Upload Rejection for Unsupported File Format or Past Expiry",
    "Verify that the system rejects unsupported file extensions (e.g. .exe, .txt) or files exceeding size limits, and flags expired licenses.",
    "Driver is on license upload page.",
    "File upload is rejected; system displays clear error guidance without saving invalid data.",
    "profile,driver,negative,upload,boundary",
    "medium", "normal", "boundary", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("Attempt to upload an unsupported executable file type.",
         "File selector flags file type mismatch.",
         "File: script.exe"),
        ("Observe upload validation toast.",
         "System rejects file immediately with message: 'Unsupported file format. Please upload JPG, PNG, or PDF files under 5MB.'",
         "Expected: Error Toast 'Unsupported file format'"),
        ("Enter an expired license date (e.g., 2020-01-01) and attempt submission.",
         "System flags date field: 'License expiration date cannot be in the past.' Form submission is blocked.",
         "Expiration Date: 2020-01-01 (Past Date)"),
        ("Verify that driver document status remains uncorrupted.",
         "Driver profile retains previous verified document or remains unsubmitted.",
         "Expected: No invalid database write")
    ],
    2, "Use Case 2: Profile Management"
)

create_tc(
    15,
    "TC-15: Manage and Update Client Profile with GPS Map Pin and Delivery Address",
    "Verify that a Client can manage business profile information, contact number, delivery address details, and update exact map coordinates via AddressMapPicker.",
    "Client is logged into Customer Portal. Customer profile exists.",
    "Customer profile record updated with latest contact details and exact latitude/longitude coordinates for delivery drop points.",
    "profile,client,address,gps,map",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Customer Portal > Account Settings / Delivery Profile.",
         "Profile edit page loads with current store profile and interactive Leaflet/MapLibre map.",
         "Nav: /customer/profile"),
        ("Update business name, contact person, and phone number.",
         "Input fields accept updated text.",
         "Business: 'Bacolod Bistro & Chill', Contact: 'Roberto Lim', Phone: '09201112233'"),
        ("Use interactive map picker to adjust the delivery drop pin to exact storefront location.",
         "Pin moves accurately on map; latitude and longitude fields auto-populate in real-time.",
         "Map Coordinates: Lat 10.6765, Lng 122.9510 (Lacson St, Bacolod City)"),
        ("Click 'Save Profile & Delivery Address'.",
         "System saves Customer model record; displays confirmation toast: 'Delivery profile and map location updated successfully'.",
         "Action: Click 'Save Profile & Delivery Address'"),
        ("Verify that saved GPS coordinates persist.",
         "Saved coordinates persist on page reload and are referenced in future delivery routing.",
         "Expected: Lat 10.6765, Lng 122.9510 preserved")
    ],
    2, "Use Case 2: Profile Management"
)

create_tc(
    16,
    "TC-16: Client Profile Address Map Pin Location Accuracy Validation",
    "Verify that the interactive map picker prevents setting coordinates outside the serviceable logistics delivery zone or missing delivery landmarks.",
    "Client is editing delivery address on Customer Portal.",
    "System warns client if coordinates are outside designated delivery perimeter or missing necessary building/landmark details.",
    "profile,client,map,validation,boundary",
    "medium", "normal", "boundary", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Open map picker and move pin to a location far outside delivery coverage area.",
         "Map pin repositions to offshore / out-of-province coordinates.",
         "Coordinates: Lat 0.000, Lng 0.000 (Off-grid)"),
        ("Leave street landmark details blank.",
         "Landmark text input is empty.",
         "Landmark: [Blank]"),
        ("Click 'Save Profile & Delivery Address'.",
         "System displays advisory: 'Selected pin is outside standard delivery coverage. Please verify your exact address.' and prompts for nearest landmark.",
         "Action: Click 'Save'"),
        ("Verify form submission status.",
         "Profile update is paused until valid location and landmark are provided.",
         "Expected: Validation banner displayed")
    ],
    2, "Use Case 2: Profile Management"
)

# ==========================================
# SUITE 3: Use Case 3: Master Data Management (8 Test Cases)
# ==========================================
create_tc(
    17,
    "TC-17: Create and Update Warehouse Data (Location, Capacity, Cold Storage Specs)",
    "Verify that the Owner can register a new warehouse facility, specify total storage capacity, cold-chain temperature zones, operating hours, and update warehouse details.",
    "Owner is logged into Admin Portal with master data access.",
    "New Warehouse record is created in database and appears in warehouse management list.",
    "master-data,warehouse,cold-storage,admin",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Master Data > Warehouse Management (/admin/warehouses).",
         "Warehouse management interface loads existing facilities.",
         "Nav: /admin/warehouses"),
        ("Click 'Add New Warehouse'.",
         "Add Warehouse modal opens with capacity, address, and temperature specification fields.",
         "Action: Click 'Add New Warehouse'"),
        ("Fill in Warehouse Name, Code, Address, Capacity (cases), Cold Room Temp (-2°C to 4°C), and Supervisor.",
         "Form fields validate input values and positive integer capacity.",
         "Name: 'Central Cold Hub Bacolod', Code: 'WH-BCD-01', Address: 'Bredco Port Area, Bacolod City', Capacity: 15000, Temp: '-2°C to 4°C', Supervisor: 'Eduardo Gomez'"),
        ("Click 'Save Warehouse'.",
         "System creates Warehouse record in database and displays toast 'Warehouse facility created successfully'.",
         "Action: Click 'Save Warehouse'"),
        ("Verify warehouse listing in master data table.",
         "New facility is listed with active status, capacity gauge, and cold-room temperature indicator.",
         "Expected: WH-BCD-01 visible in /admin/warehouses list")
    ],
    3, "Use Case 3: Master Data Management"
)

create_tc(
    18,
    "TC-18: Warehouse Creation Validation on Duplicate Code or Zero Capacity",
    "Verify that the system blocks warehouse creation if the warehouse code already exists or capacity is set to zero or negative values.",
    "Owner is on Add Warehouse form. Warehouse 'WH-BCD-01' already exists in database.",
    "Form submission is blocked; error alerts highlight conflicting code and invalid capacity.",
    "master-data,warehouse,negative,validation",
    "medium", "normal", "boundary", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("In Add Warehouse modal, enter existing code 'WH-BCD-01'.",
         "Code field receives duplicate code string.",
         "Code: WH-BCD-01 (Duplicate)"),
        ("Enter capacity '-500' in capacity input.",
         "Capacity field receives negative integer.",
         "Capacity: -500 (Invalid)"),
        ("Click 'Save Warehouse'.",
         "System blocks save operation with errors: 'Warehouse code must be unique' and 'Capacity must be greater than 0'.",
         "Action: Click 'Save Warehouse'"),
        ("Verify database state.",
         "No duplicate warehouse row is written to the database.",
         "Expected: Warehouse count remains unchanged")
    ],
    3, "Use Case 3: Master Data Management"
)

create_tc(
    19,
    "TC-19: Register and Update Delivery Vehicle Records (Plate No, Refrigeration Specs, Capacity)",
    "Verify that the Owner can register fleet vehicles with plate number, make/model, cold-storage unit type, maximum case capacity, payload weight limit, and maintenance status.",
    "Owner is logged into Admin Portal. Master data vehicle section accessible.",
    "Vehicle record created in database with status 'Available' and linked refrigeration attributes.",
    "master-data,fleet,vehicle,cold-chain,admin",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Master Data > Vehicle Management (/admin/vehicles).",
         "Vehicle management table displayed with current fleet status.",
         "Nav: /admin/vehicles"),
        ("Click 'Add New Vehicle'.",
         "Add Vehicle modal displayed with specifications form.",
         "Action: Click 'Add New Vehicle'"),
        ("Enter Plate Number, Model, Max Case Capacity, Max Weight, Chiller Unit Model, and Status.",
         "Form inputs populate with vehicle technical specifications.",
         "Plate: 'ABC-1234', Model: 'Isuzu NPR Reefer Van', Capacity: 450, MaxWeight: 3500 kg, Chiller: 'Carrier Neos 100 (-5C)', Status: 'Available'"),
        ("Click 'Register Vehicle'.",
         "System saves Vehicle record in database and displays toast 'Vehicle registered successfully'.",
         "Action: Click 'Register Vehicle'"),
        ("Verify vehicle in fleet list.",
         "New vehicle appears in the active fleet list ready for trip assignments.",
         "Expected: Vehicle ABC-1234 listed with status 'Available'")
    ],
    3, "Use Case 3: Master Data Management"
)

create_tc(
    20,
    "TC-20: Vehicle Registration Validation on Duplicate Plate Number",
    "Verify that the system enforces plate number uniqueness and rejects registration of duplicate vehicle license plates.",
    "Owner is on Add Vehicle form. Vehicle with plate 'ABC-1234' exists.",
    "System rejects duplicate plate registration with descriptive error.",
    "master-data,vehicle,negative,validation",
    "medium", "normal", "functional", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("In Add Vehicle modal, enter existing plate number 'ABC-1234'.",
         "Plate number input field receives existing string.",
         "Plate Number: ABC-1234 (Duplicate)"),
        ("Fill in other required vehicle details.",
         "Model and capacity fields filled.",
         "Model: Mitsubishi Canter, Capacity: 300"),
        ("Click 'Register Vehicle'.",
         "System catches integrity violation and returns: 'A vehicle with plate number ABC-1234 already exists.'",
         "Action: Click 'Register Vehicle'"),
        ("Verify database state.",
         "No duplicate vehicle record created in database.",
         "Expected: Vehicle table unchanged")
    ],
    3, "Use Case 3: Master Data Management"
)

create_tc(
    21,
    "TC-21: Assign and Manage Driver-to-Vehicle Allocation",
    "Verify that the Owner can assign an active certified Driver to an available fleet Vehicle and update or reassign vehicle allocations.",
    "Active Driver and available Vehicle exist in the system.",
    "Driver-vehicle mapping is recorded and updated in the system.",
    "master-data,driver,vehicle,assignment,admin",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Master Data > Driver-Vehicle Assignments.",
         "Assignment management view displays current active pairings.",
         "Nav: /admin/assignments"),
        ("Select an available Driver from the driver dropdown selector.",
         "Driver dropdown displays active drivers with verified licenses.",
         "Driver: Juan Perez (License: Valid)"),
        ("Select an available Vehicle from the vehicle dropdown selector.",
         "Vehicle dropdown displays available reefers with passed maintenance checks.",
         "Vehicle: ABC-1234 (Isuzu Reefer)"),
        ("Set Assignment Date and Shift.",
         "Shift selector accepts morning/evening logistics shift.",
         "Shift: Morning Logistics Shift"),
        ("Click 'Assign Vehicle'.",
         "System validates pairing availability, records assignment, and displays confirmation 'Driver Juan assigned to Vehicle ABC-1234'.",
         "Action: Click 'Assign Vehicle'"),
        ("Verify active pairing status badge.",
         "Driver and vehicle status badges update to 'Assigned' in fleet list.",
         "Expected: Status updated to 'Assigned'")
    ],
    3, "Use Case 3: Master Data Management"
)

create_tc(
    22,
    "TC-22: Prevent Conflict on Driver or Vehicle Double Assignment",
    "Verify that the system prevents assigning a driver or vehicle that is already active on another ongoing trip or conflicting assignment shift.",
    "Driver Juan is already assigned to active Vehicle ABC-1234 on Trip #101.",
    "System disallows duplicate assignment and displays availability warning.",
    "master-data,driver,vehicle,negative,concurrency",
    "high", "major", "functional", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("Open Vehicle Assignment modal in Admin Portal.",
         "Assignment modal is displayed.",
         "Nav: /admin/assignments -> New Assignment"),
        ("Select Driver Juan who is currently active on Trip #101.",
         "Driver selector flags driver as '(Currently Active on Trip #101)'.",
         "Driver: Juan Perez (Active)"),
        ("Select a different target vehicle.",
         "Vehicle XYZ-9876 selected.",
         "Vehicle: XYZ-9876"),
        ("Click 'Assign Vehicle'.",
         "System blocks conflicting assignment: 'Driver is currently assigned to active trip and cannot be reassigned until trip completion.'",
         "Action: Click 'Assign Vehicle'"),
        ("Verify assignment state.",
         "Original active trip assignment remains untouched.",
         "Expected: No conflicting assignment saved")
    ],
    3, "Use Case 3: Master Data Management"
)

create_tc(
    23,
    "TC-23: Add and Update Beverage Product Catalog Records & Packaging Profiles",
    "Verify that the Owner can create beverage products with SKU, variety, packaging type (e.g. 24x330ml returnable glass bottle case), deposit rates, price per case, and temperature requirements.",
    "Owner is logged into Admin Portal with product management privileges.",
    "Product record and packaging profile created in database and made available in customer ordering catalog.",
    "master-data,products,catalog,pricing,deposit,admin",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Master Data > Product Management (/admin/products).",
         "Product catalog table displayed with search, SKU, and category filters.",
         "Nav: /admin/products"),
        ("Click 'Add New Product'.",
         "Add Product modal opened with packaging and deposit configuration fields.",
         "Action: Click 'Add New Product'"),
        ("Enter Product Name, SKU, Category, Unit Size, Bottles Per Case, Case Price, Bottle Deposit, and Shell Deposit.",
         "Inputs populate and deposit totals calculate automatically (₱120 + ₱80 = ₱200/case).",
         "Name: 'San Miguel Pale Pilsen 330ml Glass Case', SKU: 'BEV-SMP-330-RGB24', Category: 'Beverages', BottlesPerCase: 24, CasePrice: 1250.00, BottleDeposit: 120.00, ShellDeposit: 80.00, TempReq: 'Cold 2-8°C'"),
        ("Upload product image asset.",
         "Product image uploaded, preview rendered, and file validated.",
         "Image: sm_pale_pilsen.png"),
        ("Click 'Save Product'.",
         "System creates Product and ProductPackaging records in database; displays toast 'Product San Miguel Pale Pilsen 330ml created successfully'.",
         "Action: Click 'Save Product'"),
        ("Verify product in catalog list.",
         "Product is listed with active badge and made available for inventory receiving and customer ordering.",
         "Expected: Product visible in /admin/products and /customer/shop")
    ],
    3, "Use Case 3: Master Data Management"
)

create_tc(
    24,
    "TC-24: Product Record Validation on Negative Price or Missing Packaging Specifications",
    "Verify that product creation is blocked when unit price is negative/zero or required packaging profile (units per case) is omitted.",
    "Owner is on Add Product form in Admin Portal.",
    "Form submission blocked with clear validation indicators.",
    "master-data,products,negative,validation",
    "medium", "normal", "boundary", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("In Add Product form, enter Product Name.",
         "Product name accepted.",
         "Name: 'Sample Beverage'"),
        ("Enter a negative value in Case Price field.",
         "Price field receives negative number.",
         "Case Price: -100.00 (Invalid)"),
        ("Leave Bottles per Case input blank.",
         "Packaging specification field is omitted.",
         "Bottles per Case: [Blank]"),
        ("Click 'Save Product'.",
         "System blocks save: 'Price must be greater than zero' and 'Packaging units per case is required'. No record is created.",
         "Action: Click 'Save Product'")
    ],
    3, "Use Case 3: Master Data Management"
)

# ==========================================
# SUITE 4: Use Case 4: Inventory Management (6 Test Cases)
# ==========================================
create_tc(
    25,
    "TC-25: Receive and Categorize Stock Batch (Batch Number, Expiry, Variety, Case Count)",
    "Verify that Warehouse Staff can log received stock shipments, enter batch numbers, manufacturing/expiry dates, warehouse location, variety, unit size, and case quantities.",
    "Warehouse Staff is logged into Warehouse Portal. Product records exist.",
    "New StockBatch record created, inventory quantities updated, and batch logged with categorization tags.",
    "inventory,stock-batch,receiving,warehouse",
    "critical", "blocker", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Warehouse Portal > Inventory > 'Receive Stock Batch' (/warehouse/inventory/receive).",
         "Stock receiving form displays product selector and batch metadata inputs.",
         "Nav: /warehouse/inventory/receive"),
        ("Select target product from catalog dropdown.",
         "Product details auto-populate packaging specs (24 bottles/case).",
         "Product: San Miguel Pale Pilsen 330ml (SKU: BEV-SMP-330-RGB24)"),
        ("Enter Batch Number, Production Date, and Expiration Date.",
         "Date inputs validated (expiration date must be in the future).",
         "Batch: 'BATCH-202608-01', Mfg: '2026-08-01', Exp: '2027-08-01'"),
        ("Enter Received Quantity and Storage Bay / Cold Room Location.",
         "Quantity accepted as positive integer.",
         "Quantity: 500 cases, Location: ColdBay-A1"),
        ("Select warehouse classification (Standard Stock).",
         "Classification tag assigned to batch.",
         "Category: Standard Stock"),
        ("Click 'Confirm Batch Receiving'.",
         "System creates StockBatch record, increases Inventory quantity_on_hand by 500 cases, logs STOCK_IN transaction, and displays confirmation.",
         "Action: Click 'Confirm Batch Receiving'")
    ],
    4, "Use Case 4: Inventory Management"
)

create_tc(
    26,
    "TC-26: Stock Batch Receiving Validation on Expired Expiration Date or Zero Quantity",
    "Verify that the system rejects stock batch entries with expiration dates in the past or invalid quantities.",
    "Warehouse Staff is on Stock Receiving page.",
    "Batch receiving rejected; error messages prevent invalid inventory ingestion.",
    "inventory,stock-batch,negative,validation",
    "high", "normal", "boundary", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("Select product on receiving form.",
         "Product selected.",
         "Product: San Miguel Pale Pilsen 330ml"),
        ("Enter an expiration date that has already passed.",
         "Date input receives past date.",
         "Exp Date: 2025-01-01 (Past Date)"),
        ("Enter Received Quantity as 0 or negative number.",
         "Quantity field receives 0.",
         "Quantity: 0 (Invalid)"),
        ("Click 'Confirm Batch Receiving'.",
         "System blocks submission with error messages: 'Expiration date must be at least 30 days in the future for receiving' and 'Received quantity must be a positive integer'.",
         "Action: Click 'Confirm Batch Receiving'")
    ],
    4, "Use Case 4: Inventory Management"
)

create_tc(
    27,
    "TC-27: Update Inventory Quantities (On-Hand, Available, Damaged / Quarantine)",
    "Verify that Warehouse Staff can adjust inventory quantities based on physical cycle counts, segregating damaged/broken bottles into quarantine status.",
    "Warehouse Staff is logged in. Existing stock batches exist in warehouse.",
    "Inventory on-hand and available quantities updated in real-time, damaged stock moved to quarantine balance.",
    "inventory,adjustment,quarantine,damage,warehouse",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Warehouse Portal > Inventory > 'Inventory Adjustments'.",
         "Inventory adjustments view loads current on_hand, allocated, and damaged tallies.",
         "Nav: /warehouse/inventory/adjustments"),
        ("Select Warehouse facility and Product.",
         "Product stock summary retrieved from backend.",
         "Warehouse: Central Cold Hub, Product: San Miguel Pale Pilsen 330ml"),
        ("Enter Adjustment Reason from dropdown.",
         "Reason selected from standardized options.",
         "Reason: 'Handling Breakage during restock'"),
        ("Specify Damaged Case Count and New Physical Count.",
         "System calculates adjustment delta.",
         "Damaged Count: 5 cases, Adjusted Total On-Hand: 495 cases"),
        ("Click 'Submit Adjustment'.",
         "System saves new inventory balances: On-hand set to 495, Damaged/Quarantine increased by 5 cases, Available updated, and displays 'Inventory adjusted successfully'.",
         "Action: Click 'Submit Adjustment'")
    ],
    4, "Use Case 4: Inventory Management"
)

create_tc(
    28,
    "TC-28: Record Inventory Transactions Audit Trail (Stock In, Stock Out, Transfer, Adjustment)",
    "Verify that every stock movement automatically generates an immutable InventoryTransaction record with timestamp, user actor, batch ID, and quantity delta.",
    "Inventory operations (Receiving, Order Fulfillment, Adjustment) have taken place.",
    "Audit trail in InventoryTransaction table accurately reflects all stock movements.",
    "inventory,transactions,audit,compliance",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Warehouse Portal / Admin Portal > Inventory > 'Transaction Logs'.",
         "Transaction log table displays all historical stock events in reverse chronological order.",
         "Nav: /warehouse/inventory/transactions"),
        ("Filter transactions by Date Range and Transaction Type ('STOCK_IN').",
         "Filters apply dynamically; matching transaction rows displayed.",
         "Filter: Type = 'STOCK_IN', Date = Today"),
        ("Click on a transaction entry to view detailed audit metadata.",
         "Transaction detail modal shows precise user identity, batch number, previous quantity, new quantity, and timestamp.",
         "Inspect: TX-20260824-001"),
        ("Verify that logged quantity delta matches physical stock movement.",
         "Audit log delta (+500 cases) perfectly matches database Inventory delta.",
         "Expected: Audit record verified")
    ],
    4, "Use Case 4: Inventory Management"
)

create_tc(
    29,
    "TC-29: Monitor Stock Availability Matrix and Low-Stock Alert Notifications",
    "Verify that the system monitors current available stock against configured reorder thresholds and displays visual alert badges / triggers low-stock notifications.",
    "Product reorder threshold is set to 50 cases. Inventory level falls to 40 cases.",
    "Low-stock alert banner is visible on Warehouse and Admin dashboards.",
    "inventory,monitoring,alerts,reorder",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin / Warehouse Portal > Stock Monitoring overview.",
         "Stock overview loads with color-coded stock health indicators across all SKUs.",
         "Nav: /warehouse/inventory/monitoring"),
        ("Inspect the stock availability matrix for all beverage products.",
         "Matrix displays On-Hand, Allocated, and Available counts per item.",
         "Product: Red Horse Beer 500ml"),
        ("Locate SKU with stock below reorder threshold.",
         "Item is highlighted with amber/red 'Low Stock Alert - 40 cases remaining (Threshold: 50)' badge.",
         "Available: 40 cases, Reorder Point: 50 cases"),
        ("Check Notification Center dropdown in header.",
         "Automated notification entry found in bell icon popup with action link to restock.",
         "Notification: 'Low stock warning for Red Horse Beer 500ml'")
    ],
    4, "Use Case 4: Inventory Management"
)

create_tc(
    30,
    "TC-30: Prevent Negative Inventory Stock Balances during Warehouse Deductions",
    "Verify that the system blocks manual stock deductions or dispatch operations that would result in negative available inventory.",
    "Product available stock is 20 cases.",
    "System rejects manual deduction greater than 20 cases and maintains non-negative balance.",
    "inventory,negative,integrity,boundary",
    "critical", "critical", "boundary", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("Open Inventory Adjustment modal for product with 20 available cases.",
         "Modal displays current available stock: 20 cases.",
         "Nav: /warehouse/inventory/adjustments"),
        ("Enter deduction quantity of 30 cases (attempting reduction below 0).",
         "Input field receives 30 cases deduction.",
         "Requested Deduction: 30 cases (Exceeds 20)"),
        ("Click 'Submit Adjustment'.",
         "System blocks transaction: 'Cannot deduct 30 cases. Maximum available stock is 20 cases.'",
         "Action: Click 'Submit Adjustment'"),
        ("Verify inventory database integrity.",
         "Available stock remains 20 cases; negative balance strictly prevented.",
         "Expected: Inventory balance remains 20")
    ],
    4, "Use Case 4: Inventory Management"
)

# ==========================================
# SUITE 5: Use Case 5: Order Fulfillment & Processing (6 Test Cases)
# ==========================================
create_tc(
    31,
    "TC-31: Client Places Order Successfully (Catalog Browsing, Cart, and Checkout)",
    "Verify that a verified Client can browse product catalog, add beverage cases to cart, review pricing and deposit breakdown, and place an order successfully.",
    "Client is logged in with active verified account. Products have available stock.",
    "Order and OrderItem records created with status 'CONFIRMED' / 'PENDING_PREPARATION', inventory reserved.",
    "orders,checkout,cart,client,smoke",
    "critical", "blocker", "smoke", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Customer Portal > Product Catalog (/customer/shop).",
         "Product catalog renders with real-time pricing and stock status badges.",
         "Nav: /customer/shop"),
        ("Select products and add cases to cart.",
         "Items added to cart; cart badge updates counter.",
         "Item 1: 10 cases San Miguel Pale Pilsen (@ ₱1,250), Item 2: 5 cases Red Horse 500ml (@ ₱1,400)"),
        ("Open Cart drawer and review line items, subtotal, bottle deposit fees, and tax.",
         "Cart displays item subtotal (₱19,500), packaging deposit line (₱3,000), and grand total (₱22,500).",
         "Subtotal: ₱19,500, Deposit: ₱3,000, Grand Total: ₱22,500"),
        ("Select preferred delivery date and confirm delivery address.",
         "Delivery details auto-populate from verified customer profile.",
         "Delivery Date: Tomorrow (2026-08-25)"),
        ("Click 'Place Order' / 'Confirm Purchase'.",
         "System verifies stock availability, creates Order record, creates OrderTimeline entry, decrements available inventory, and returns 201 Created.",
         "Action: Click 'Place Order'"),
        ("Verify order confirmation screen and receipt reference.",
         "Order confirmation page displayed with unique Order ID (e.g. ORD-20260824-0012) and downloadable summary.",
         "Expected: Confirmation screen with Order ORD-20260824-0012")
    ],
    5, "Use Case 5: Order Fulfillment & Processing"
)

create_tc(
    32,
    "TC-32: Mixed Case Composition, Bottle Deposit Calculation, and Inventory Reservation",
    "Verify that the Client can build a customized Mixed Case (assorted beverage varieties per case) and that the system properly reserves individual component inventory and calculates correct bottle deposits.",
    "Client is on the Mixed Case Builder section. Individual beverage varieties are in stock.",
    "MixedCaseComponent records saved, component inventories reserved, and deposits calculated accurately.",
    "orders,mixed-case,deposit,inventory-reservation,client",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Customer Portal > 'Custom Mixed Case Builder'.",
         "Mixed case builder tool initializes with interactive 24-slot case grid.",
         "Nav: /customer/mixed-case-builder"),
        ("Configure a 24-bottle mixed case with assorted varieties.",
         "Live bottle counter tracks sum towards 24 bottles (12 Pale Pilsen + 6 San Mig Light + 6 Super Dry).",
         "Bottles: 12x Pale Pilsen, 6x San Mig Light, 6x Super Dry (Total: 24/24)"),
        ("Select Mixed Case quantity and click 'Add Mixed Case to Cart'.",
         "Mixed case added to cart with itemized breakdown and deposit fee (₱200/case).",
         "Quantity: 2 Mixed Cases (48 bottles total)"),
        ("Proceed to checkout and click 'Place Order'.",
         "System checks stock for each individual variety in warehouse and creates MixedCaseComponent database rows.",
         "Action: Click 'Place Order'"),
        ("Verify inventory reservations in backend.",
         "Component inventories reserved accurately (24 Pale Pilsen, 12 San Mig Light, 12 Super Dry bottles reserved).",
         "Expected: Inventory reservations committed without discrepancy")
    ],
    5, "Use Case 5: Order Fulfillment & Processing"
)

create_tc(
    33,
    "TC-33: Order Placement Blocked / Rejected Due to Insufficient Stock Availability",
    "Verify that the system detects insufficient stock when a Client requests more cases than available in the warehouse, preventing checkout and displaying out-of-stock warning.",
    "Client has 50 cases in cart; warehouse only has 20 available cases.",
    "Order submission is blocked; system notifies client of stock shortage and suggests adjusting quantity.",
    "orders,insufficient-stock,validation,negative",
    "critical", "blocker", "functional", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Customer Portal catalog and select item with 20 cases available.",
         "Product details show available stock: 20 cases.",
         "Product: San Miguel Pale Pilsen 330ml (Available: 20 cases)"),
        ("Input order quantity of 50 cases and add to cart.",
         "Cart drawer alerts that requested quantity exceeds available stock.",
         "Requested: 50 cases"),
        ("Attempt to click 'Place Order' on checkout screen.",
         "System blocks checkout: 'Insufficient stock. Only 20 cases of this item are currently available. Please adjust your order quantity.'",
         "Action: Click 'Place Order'"),
        ("Verify database order records.",
         "No order record is created; available inventory remains 20 cases.",
         "Expected: No order generated")
    ],
    5, "Use Case 5: Order Fulfillment & Processing"
)

create_tc(
    34,
    "TC-34: Stock Allocation Race Condition Prevention under Concurrent Client Orders",
    "Verify that concurrent checkout requests from multiple clients competing for the last remaining stock do not cause overselling (database row locking / transaction isolation).",
    "Stock available is 10 cases. Client A and Client B both attempt to order 10 cases simultaneously.",
    "One client successfully secures order; second client receives out-of-stock notice. Inventory never goes negative.",
    "orders,concurrency,race-condition,integrity",
    "high", "critical", "functional", "negative", "to-be-automated", "actual", "no", "api",
    [
        ("Set product stock to 10 cases in warehouse.",
         "Inventory balance confirmed: 10 cases available.",
         "Product: San Miguel Pale Pilsen (Available: 10)"),
        ("Simultaneously submit Order Placement API calls for Client A (10 cases) and Client B (10 cases).",
         "Both checkout requests hit the server concurrently.",
         "Client A: Qty 10, Client B: Qty 10"),
        ("Inspect API responses for both clients.",
         "First request succeeds with 201 Created and decrements stock to 0. Second request cleanly rolls back and returns 400 Bad Request ('Stock depleted').",
         "Expected: Client A -> 201 Created; Client B -> 400 Out of Stock"),
        ("Verify final inventory quantity in database.",
         "Inventory balance is exactly 0 cases; negative balance strictly avoided.",
         "Expected: Inventory quantity = 0")
    ],
    5, "Use Case 5: Order Fulfillment & Processing"
)

create_tc(
    35,
    "TC-35: Warehouse Staff Views Confirmed Orders and Generates Item Picking Checklist",
    "Verify that Warehouse Staff can view all confirmed client orders in real-time, inspect item details, and generate a warehouse picking and packing checklist.",
    "Warehouse Staff is logged into Warehouse Portal. Confirmed client orders exist.",
    "Confirmed orders displayed in order staging queue; picking list item quantities verified.",
    "orders,warehouse,picking,staging",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Warehouse Portal > Orders Fulfillment > 'Confirmed Orders'.",
         "Orders queue displays pending confirmed orders sorted by scheduled delivery date.",
         "Nav: /warehouse/orders"),
        ("Filter orders by status 'CONFIRMED' or 'AWAITING_PREPARATION'.",
         "Table filters matching orders with customer name, case count, and value.",
         "Filter: Status = 'CONFIRMED'"),
        ("Select an order to view full line items and delivery notes.",
         "Order detail drawer opens displaying itemized beverage cases and batch locations.",
         "Order: ORD-20260824-0012 (Client: Bacolod Bistro, 15 cases)"),
        ("Click 'Generate Picking List' / 'Print Pack Sheet'.",
         "System compiles picking checklist aggregating SKUs, case counts, and cold-room bay locations.",
         "Action: Click 'Generate Picking List'"),
        ("Verify picking sheet output layout.",
         "Picking list renders with checkboxes, batch barcodes, and pallet locations for warehouse floor staff.",
         "Expected: Printable picking sheet displayed")
    ],
    5, "Use Case 5: Order Fulfillment & Processing"
)

create_tc(
    36,
    "TC-36: Warehouse Staff Completes Order Staging and Marks Ready for Dispatch",
    "Verify that Warehouse Staff can mark picked cases as staged in the loading dock and update order status to 'READY_FOR_DELIVERY'.",
    "Confirmed order has been physically picked and packed by warehouse staff.",
    "Order status updated to 'READY_FOR_DELIVERY', making it eligible for trip consolidation.",
    "orders,warehouse,staging,dispatch",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Open the picked order in Warehouse Portal.",
         "Order staging checklist interface displayed.",
         "Order: ORD-20260824-0012"),
        ("Check off all picked items against physical pallet checklist.",
         "All items marked as picked and inspected.",
         "Items: 15 cases picked and verified"),
        ("Specify staging loading dock location.",
         "Staging dock input populated.",
         "Staging Dock: Dock 2 (Cold Staging)"),
        ("Click 'Mark Order as Staged & Ready for Delivery'.",
         "System updates Order status to 'READY_FOR_DELIVERY' and records OrderTimeline entry.",
         "Action: Click 'Mark as Staged'"),
        ("Verify order availability in trip planning queue.",
         "Order is now visible in the Delivery Trip creation queue for dispatching.",
         "Expected: Order listed in Trip Dispatch queue")
    ],
    5, "Use Case 5: Order Fulfillment & Processing"
)

# ==========================================
# SUITE 6: Use Case 6: Transportation Management (8 Test Cases)
# ==========================================
create_tc(
    37,
    "TC-37: Create Delivery Trip and Assign Orders, Driver, and Refrigerated Vehicle",
    "Verify that the Owner or Warehouse Staff can create a new delivery trip, group multiple customer drop points, and assign an available Driver and refrigerated Vehicle.",
    "Warehouse Staff / Owner is logged in. Multiple staged orders, available drivers, and vehicles exist.",
    "Trip and TripDropPoint records created with status 'SCHEDULED' / 'ASSIGNED'; assigned driver notified.",
    "transportation,trips,dispatch,fleet,driver",
    "critical", "blocker", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Warehouse / Admin Portal > Transportation > 'Create Delivery Trip'.",
         "Trip creation wizard opens with available staged orders list.",
         "Nav: /warehouse/trips/create"),
        ("Select origin warehouse facility.",
         "Warehouse origin set to Central Cold Hub Bacolod.",
         "Warehouse: Central Cold Hub"),
        ("Select multiple staged orders to consolidate into the trip.",
         "Orders selected; total load calculated (80 cases) against vehicle capacity (450 cases).",
         "Orders: ORD-0012 (15 cases), ORD-0015 (40 cases), ORD-0018 (25 cases)"),
        ("Select Driver and Refrigerated Vehicle from available dropdowns.",
         "Driver and vehicle availability verified without scheduling conflicts.",
         "Driver: Juan Perez, Vehicle: ABC-1234 (Isuzu Reefer)"),
        ("Arrange drop point sequence and inspect route map preview.",
         "Interactive map renders optimized route connecting stops in sequence.",
         "Stops: Stop 1 -> Bacolod Bistro, Stop 2 -> Mandalagan Mart, Stop 3 -> Lacson Cafe"),
        ("Click 'Create & Dispatch Trip'.",
         "Trip record created with status 'ASSIGNED', TripDropPoint records created, and notification dispatched to Driver Portal.",
         "Action: Click 'Create & Dispatch Trip'")
    ],
    6, "Use Case 6: Transportation Management"
)

create_tc(
    38,
    "TC-38: Trip Creation Validation against Vehicle Weight / Volume Capacity Limit",
    "Verify that the system warns or blocks trip creation if total case quantity or weight of selected orders exceeds the assigned vehicle's maximum payload.",
    "Selected vehicle has a maximum capacity of 100 cases.",
    "System alerts user when selected orders total 150 cases and prevents overloaded dispatch.",
    "transportation,trips,capacity,boundary,negative",
    "high", "major", "boundary", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("In Trip Creation wizard, select a small delivery van with max capacity of 100 cases.",
         "Vehicle selected with capacity specification: 100 cases.",
         "Vehicle: Van XYZ-100 (Capacity: 100 cases)"),
        ("Select customer orders totaling 150 cases.",
         "Total load counter updates to 150 cases.",
         "Selected Orders: 150 cases total"),
        ("Observe payload gauge and warning indicator.",
         "Payload gauge turns RED: 'Capacity exceeded! Selected load is 150/100 cases (150%). Please remove orders or assign a larger vehicle.'",
         "Warning: Capacity Exceeded (150%)"),
        ("Attempt to click 'Create Trip'.",
         "Submit button remains disabled or blocks creation until payload is within limit.",
         "Action: Click 'Create Trip'")
    ],
    6, "Use Case 6: Transportation Management"
)

create_tc(
    39,
    "TC-39: Driver Confirms Loaded Items and Cold Chain Checklist Before Departure",
    "Verify that the assigned Driver can inspect assigned trip orders, complete the physical loading verification checklist, check chiller temperature, and confirm loaded status.",
    "Driver is logged into Driver Portal; trip assigned with status 'ASSIGNED'.",
    "Trip status transitions from 'ASSIGNED' to 'READY_FOR_DEPARTURE', pre-trip cold chain log recorded.",
    "transportation,driver,loading,cold-chain,dispatch",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Driver opens Driver Portal > Active Trips > Select Assigned Trip.",
         "Assigned trip card displayed with 'Pending Load Confirmation' badge.",
         "Nav: /driver/trips/active -> TRIP-20260824-01"),
        ("Inspect itemized load manifest listing all cases for each customer stop.",
         "Manifest displays case counts and SKU details for all 3 stops.",
         "Manifest: 80 cases total (3 stops)"),
        ("Check off each loaded batch after physical loading into vehicle.",
         "Checkboxes interactive; load checklist reaches 100% verified.",
         "Action: Check all loaded batches"),
        ("Enter chiller unit starting temperature reading.",
         "Temperature validated within cold-chain specification (below 4°C).",
         "Chiller Temp: 3.5°C"),
        ("Click 'Confirm Loaded & Ready'.",
         "System records load confirmation timestamp and updates Trip status to 'READY_FOR_DEPARTURE'.",
         "Action: Click 'Confirm Loaded & Ready'")
    ],
    6, "Use Case 6: Transportation Management"
)

create_tc(
    40,
    "TC-40: Driver Starts Trip, Enables Live GPS Location Logging, and Updates Status to In-Transit",
    "Verify that the Driver can start the trip, triggering browser/device geolocation tracking, creating LocationLog entries, and transitioning Trip status to 'IN_TRANSIT'.",
    "Driver is on confirmed trip. Device location permissions granted.",
    "Trip status set to 'IN_TRANSIT', continuous GPS coordinates streamed to backend LocationLog table.",
    "transportation,driver,gps,live-tracking,in-transit",
    "critical", "blocker", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Driver clicks 'Start Trip & Navigation' button on active trip.",
         "System requests device geolocation access.",
         "Action: Click 'Start Trip & Navigation'"),
        ("Grant geolocation permission in browser/device prompt.",
         "Geolocation permission granted; GPS coordinates acquired.",
         "Permission: Allow Geolocation"),
        ("Observe navigation screen and trip status update.",
         "Trip status updates to 'IN_TRANSIT'; live navigation map renders vehicle marker and drop point route.",
         "Status: 'IN_TRANSIT', Map: Route rendered"),
        ("Simulate movement updates and verify LocationLog backend entries.",
         "LocationLog entries created with latitude, longitude, speed, and timestamp every 15 seconds.",
         "GPS Data: Lat 10.6712, Lng 122.9501, Speed 35 km/h")
    ],
    6, "Use Case 6: Transportation Management"
)

create_tc(
    41,
    "TC-41: GPS Location Logging Continuity and Handling Loss of Signal / Reconnection",
    "Verify that if the Driver temporarily loses mobile data connection during transit, location coordinates are queued locally and synchronized upon reconnection.",
    "Driver is in transit on an active delivery trip.",
    "No telemetry data lost; offline queue syncs successfully to backend when connection resumes.",
    "transportation,gps,offline,resilience,edge",
    "medium", "normal", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Simulate network disconnection while trip is in transit.",
         "App detects offline state and displays banner 'Offline - Buffering GPS telemetry locally'.",
         "Network: Offline Mode"),
        ("Driver generates 5 simulated GPS coordinate updates while offline.",
         "Coordinates are buffered into IndexedDB / local storage.",
         "Buffered Points: 5 GPS coordinates"),
        ("Restore network connectivity.",
         "App detects online event and triggers automatic batch synchronization.",
         "Network: Online Restored"),
        ("Verify LocationLog backend database records.",
         "All 5 buffered GPS location entries are committed to backend database with original timestamps intact.",
         "Expected: 5 points committed to LocationLog")
    ],
    6, "Use Case 6: Transportation Management"
)

create_tc(
    42,
    "TC-42: Complete Drop Point Delivery with Proof of Delivery and Bottle Return Ledger Entry",
    "Verify that the Driver can arrive at a customer drop point, deliver ordered cases, record returned empty bottles/crates in the Bottle Return Ledger, capture customer signature/photo POD, and mark stop as DELIVERED.",
    "Driver is at active Drop Point stop. Client is present to receive goods.",
    "TripDropPoint marked 'DELIVERED', Order status updated to 'DELIVERED', Customer deposit/bottle balance updated in ledger.",
    "transportation,driver,delivery,pod,bottle-returns,smoke",
    "critical", "blocker", "smoke", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Driver selects Stop 1 on active trip and clicks 'Arrived at Destination'.",
         "Stop status updates to 'ARRIVED'; customer delivery details displayed.",
         "Stop 1: Bacolod Bistro (Order ORD-0012)"),
        ("Confirm delivered case count.",
         "Delivered count confirmed against manifest.",
         "Delivered: 15 cases"),
        ("Enter empty bottle/crate returns in the Bottle Return module.",
         "System calculates deposit credit (10 crates @ ₱200 = ₱2,000 credit) and updates CustomerBottleBalance ledger.",
         "Returned Bottles: 10 full crates (240 bottles)"),
        ("Capture customer e-signature and photo proof of delivery on mobile canvas.",
         "Signature canvas captures receiver signature data URL.",
         "Signature: 'Roberto Lim (Received in good order)'"),
        ("Click 'Complete Delivery Stop'.",
         "TripDropPoint status set to 'DELIVERED', Order status set to 'DELIVERED', and success confirmation shown.",
         "Action: Click 'Complete Delivery Stop'"),
        ("Verify navigation prompt to next scheduled stop.",
         "Driver Portal automatically advances to Stop 2 on route with updated ETA.",
         "Expected: Stop 2 active in navigation")
    ],
    6, "Use Case 6: Transportation Management"
)

create_tc(
    43,
    "TC-43: Drop Point Delivery Exception Handling (Client Unavailable / Partial Delivery)",
    "Verify that the Driver can flag a delivery exception if the client store is closed or refuses part of the shipment, logging return-to-warehouse items.",
    "Driver is at drop point, but client is unavailable / store closed.",
    "TripDropPoint marked 'FAILED_ATTEMPT' / 'PARTIAL_DELIVERY'; undelivered stock scheduled for warehouse return.",
    "transportation,driver,exception,undelivered,negative",
    "high", "major", "functional", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("On active stop, click 'Report Delivery Issue / Exception'.",
         "Delivery exception modal opens with standardized reason dropdown.",
         "Nav: Active Stop -> Report Exception"),
        ("Select reason 'Customer Store Closed / No Authorized Receiver'.",
         "Reason selected.",
         "Reason: 'Store Closed'"),
        ("Add descriptive notes explaining the situation.",
         "Notes textarea populated.",
         "Notes: 'Arrived at 2:15 PM, storefront locked, phone unanswered after 3 calls.'"),
        ("Capture photo of closed storefront as proof.",
         "Photo uploaded and attached to exception record.",
         "Photo: closed_storefront.jpg"),
        ("Click 'Submit Delivery Exception'.",
         "System marks stop as 'FAILED_ATTEMPT', updates order status to 'DELIVERY_FAILED', notifies Dispatcher, and routes driver to next stop.",
         "Action: Click 'Submit Exception'")
    ],
    6, "Use Case 6: Transportation Management"
)

create_tc(
    44,
    "TC-44: Client Live Delivery Tracking on Interactive Map with Real-Time ETA",
    "Verify that the Client can open the delivery tracking page on Customer Portal and observe the driver's live GPS location, route, and estimated time of arrival.",
    "Client has an active order on an in-transit delivery trip.",
    "Interactive tracking map displays driver icon, vehicle movement, current stop sequence, and dynamic ETA.",
    "transportation,client,tracking,live-map,eta",
    "high", "critical", "usability", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Client navigates to Customer Portal > 'Track My Delivery' (/customer/orders/track).",
         "Tracking page loads with order progress stepper (Ordered -> Packed -> Out for Delivery -> Delivered).",
         "Nav: /customer/orders/track?id=ORD-0012"),
        ("Inspect interactive LiveTrackingMap.",
         "Live map displays driver location pin with live coordinates from LocationLog table.",
         "Driver Marker: Active on map"),
        ("Observe delivery stop sequence and route line.",
         "Route polyline displayed between warehouse, intermediate stops, and client pin.",
         "Route: Warehouse -> Stop 1 -> Client Store"),
        ("Verify dynamic ETA counter.",
         "ETA counter updates in real time based on driver speed and distance (e.g. 'Estimated Arrival: 15 mins (2.4 km away)').",
         "ETA: '15 mins (2.4 km away)'")
    ],
    6, "Use Case 6: Transportation Management"
)

# ==========================================
# SUITE 7: Use Case 7: Replacement Handling Management (6 Test Cases)
# ==========================================
create_tc(
    45,
    "TC-45: Client Submits Defective / Damaged Product Replacement Claim with Photo Proof",
    "Verify that a Client can submit a replacement request for damaged or defective beverage bottles from a delivered order, specifying defect reason, quantity, and uploading photo evidence.",
    "Client has a DELIVERED order. Defective product reporting window is open.",
    "Replacement record created in database with status 'PENDING_VERIFICATION'.",
    "replacements,defects,claims,client,smoke",
    "high", "critical", "smoke", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Customer Portal > Orders > Order History.",
         "Order history lists completed delivered orders.",
         "Nav: /customer/orders/history"),
        ("Select delivered order and click 'Report Defective Product / Request Replacement'.",
         "Replacement claim form opens displaying line items from that order.",
         "Order: ORD-0012"),
        ("Select defective product item and enter defective quantity.",
         "Item selected and quantity specified.",
         "Item: San Miguel Pale Pilsen 330ml, Defect Qty: 6 bottles"),
        ("Select Defect Reason from dropdown.",
         "Reason selected.",
         "Reason: 'Broken Seal / Leaked in Crate'"),
        ("Upload clear photo evidence of defective items.",
         "Image uploaded and preview thumbnail displayed.",
         "File: broken_bottles_evidence.jpg"),
        ("Click 'Submit Replacement Claim'.",
         "System creates Replacement record with ID REP-20260824-001; status set to 'PENDING_VERIFICATION'; confirmation alert shown.",
         "Action: Click 'Submit Replacement Claim'")
    ],
    7, "Use Case 7: Replacement Handling Management"
)

create_tc(
    46,
    "TC-46: Defective Product Claim Submission Validation (Missing Photo or Exceeded Return Window)",
    "Verify that replacement claims are rejected if required photographic proof is missing or if the claim is submitted after the allowable replacement SLA window.",
    "Client is on replacement submission form. Delivered order is 30 days old (SLA limit: 3 days).",
    "Submission blocked with appropriate policy warning.",
    "replacements,negative,validation,boundary",
    "medium", "normal", "boundary", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("On replacement claim form, fill in defect quantity but omit photo evidence.",
         "Form filled without image attachment.",
         "Defect Qty: 6 bottles, Photo: [None]"),
        ("Click 'Submit Replacement Claim'.",
         "System blocks submission: 'Photo evidence is required for replacement verification.'",
         "Action: Click 'Submit Claim'"),
        ("Attempt to open replacement form on an order delivered past the 72-hour SLA policy window.",
         "System displays notice: 'Replacement request window for this order has expired (Policy: within 72 hours of delivery). Please contact support.'",
         "Delivered Date: 30 days ago"),
        ("Verify database state.",
         "No replacement record is created.",
         "Expected: Database remains unchanged")
    ],
    7, "Use Case 7: Replacement Handling Management"
)

create_tc(
    47,
    "TC-47: Owner / Warehouse Staff Reviews and Verifies / Approves Replacement Claim",
    "Verify that the Owner or Warehouse Staff can inspect pending replacement claims, review customer photo proof, and approve or reject the claim with comments.",
    "Owner/Warehouse Staff logged in. Pending replacement claim exists.",
    "Replacement status updated to 'VERIFIED' / 'APPROVED', customer notified.",
    "replacements,verification,approval,admin,warehouse",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin / Warehouse Portal > 'Replacement Management' (/admin/replacements).",
         "Replacement dashboard displays queue of submitted claims.",
         "Nav: /admin/replacements"),
        ("Filter claims by status 'PENDING_VERIFICATION'.",
         "Pending claim REP-20260824-001 displayed.",
         "Filter: Status = 'PENDING_VERIFICATION'"),
        ("Select claim to view submitted defect details and photo evidence in full resolution.",
         "Claim details modal renders high-res photo, customer order history, and claimed items.",
         "Claim: REP-20260824-001 (Client: Bacolod Bistro)"),
        ("Enter reviewer verification remarks.",
         "Remarks input populated.",
         "Notes: 'Valid transit damage. Approved for 6 replacement bottles.'"),
        ("Click 'Approve & Verify Replacement'.",
         "System updates Replacement status to 'VERIFIED', creates audit timestamp, and notifies Client and warehouse dispatch team.",
         "Action: Click 'Approve & Verify'")
    ],
    7, "Use Case 7: Replacement Handling Management"
)

create_tc(
    48,
    "TC-48: Owner and Warehouse Staff Monitor Replacement Dashboard and Quarantine Inventory",
    "Verify that the Owner and Warehouse Staff can monitor all replacement metrics (defect rate by product, replacement turnaround time, quarantine damaged inventory balance).",
    "Multiple replacement cases in various states exist in database.",
    "Replacement summary analytics and quarantine inventory statistics accurately rendered.",
    "replacements,monitoring,dashboard,quarantine",
    "medium", "normal", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Replacement Management > Dashboard & Summary.",
         "Replacement dashboard renders summary KPIs: Total Claims, Verified, In-Transit Redelivery, Closed.",
         "Nav: /admin/replacements/dashboard"),
        ("Review overall replacement defect distribution by beverage variety.",
         "Charts display defect breakdown per SKU and defect reason.",
         "Chart: Defect distribution"),
        ("Inspect Quarantine Inventory balance table for damaged products awaiting disposal.",
         "Quarantine table shows exact count of damaged bottles isolated from sellable stock.",
         "Quarantine Stock: 42 bottles (isolated)"),
        ("Filter dashboard metrics by date range.",
         "Analytics cards update dynamically based on selected date filter.",
         "Filter: Date = Current Month")
    ],
    7, "Use Case 7: Replacement Handling Management"
)

create_tc(
    49,
    "TC-49: Warehouse Staff Allocates Replacement Stock and Assigns Driver for Redelivery",
    "Verify that Warehouse Staff can allocate replacement stock from spare inventory, generate a redelivery dispatch order, and assign a Driver for redelivery.",
    "A replacement claim is in 'VERIFIED' status. Spare stock is available in warehouse.",
    "Replacement status updated to 'ASSIGNED_FOR_REDELIVERY', redelivery task assigned to driver.",
    "replacements,redelivery,dispatch,warehouse,driver",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("In Warehouse Portal, open verified replacement claim REP-20260824-001.",
         "Verified claim details opened with 'Schedule Redelivery' option.",
         "Claim: REP-20260824-001"),
        ("Click 'Schedule Redelivery / Assign Driver'.",
         "Redelivery assignment modal loads.",
         "Action: Click 'Schedule Redelivery'"),
        ("Select source warehouse storage bay for replacement items.",
         "Warehouse stock allocated for 6 replacement bottles.",
         "Source Bay: ColdBay-A1 (6 bottles allocated)"),
        ("Assign Driver and Vehicle (or attach to upcoming trip route).",
         "Driver assigned; task scheduled in driver manifest.",
         "Driver: Juan Perez, Vehicle: ABC-1234"),
        ("Click 'Confirm Redelivery Assignment'.",
         "System updates Replacement status to 'ASSIGNED_FOR_REDELIVERY'; Driver receives task notification.",
         "Action: Click 'Confirm Assignment'")
    ],
    7, "Use Case 7: Replacement Handling Management"
)

create_tc(
    50,
    "TC-50: Driver Completes Replacement Item Redelivery and Retrieves Damaged Unit",
    "Verify that the Driver delivers replacement items to the client, collects the damaged bottles, captures receiver signature, and marks replacement redelivery as COMPLETED.",
    "Driver has assigned redelivery task on active trip manifest.",
    "Replacement status updated to 'COMPLETED'; damaged units logged for return to warehouse quarantine.",
    "replacements,driver,redelivery,completion",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Driver opens assigned redelivery task in Driver Portal.",
         "Driver portal displays replacement handover instructions and client address.",
         "Task: Redelivery for REP-20260824-001"),
        ("Hand over replacement bottles to Client and collect physical damaged bottles.",
         "Physical handover verified.",
         "Delivered: 6 bottles replacement, Retrieved: 6 damaged bottles"),
        ("Capture customer signature acknowledging receipt of replacement.",
         "Customer signature captured on mobile screen.",
         "Signature: 'Roberto Lim'"),
        ("Click 'Complete Redelivery & Return Damaged Items'.",
         "System updates Replacement status to 'COMPLETED'; records damaged items retrieval in driver return manifest.",
         "Action: Click 'Complete Redelivery'")
    ],
    7, "Use Case 7: Replacement Handling Management"
)

# ==========================================
# SUITE 8: Use Case 8: Feedback Management (4 Test Cases)
# ==========================================
create_tc(
    51,
    "TC-51: Client Submits Star Rating and Detailed Feedback on Completed Order & Delivery",
    "Verify that a Client can submit a 1-5 star rating, delivery performance feedback, and product quality comments after an order has been delivered.",
    "Client is logged into Customer Portal. A DELIVERED order exists without previous feedback.",
    "Feedback record created in database with status 'PENDING_REVIEW' and linked to Order and Customer.",
    "feedback,ratings,csat,client,smoke",
    "high", "critical", "smoke", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Customer Portal > Orders > Completed Orders.",
         "Completed orders list displayed with 'Rate & Review' action button.",
         "Nav: /customer/orders/history"),
        ("Click 'Rate & Review Order' on delivered order.",
         "Feedback modal opens with interactive 5-star rating components.",
         "Order: ORD-0012"),
        ("Select Star Rating (5 Stars) for Overall Satisfaction, Speed, and Quality.",
         "Star rating selections highlight accurately (5/5).",
         "Rating: 5 Stars (Overall, Speed, Quality)"),
        ("Enter detailed review comments.",
         "Comment textarea populated.",
         "Comment: 'Delivery arrived right on time and beverages were perfectly chilled. Excellent service!'"),
        ("Click 'Submit Feedback'.",
         "System saves Feedback record linked to Order ID; displays toast 'Thank you for your feedback!'; order card updates with 'Feedback Submitted' badge.",
         "Action: Click 'Submit Feedback'")
    ],
    8, "Use Case 8: Feedback Management"
)

create_tc(
    52,
    "TC-52: Feedback Submission Validation on Missing Star Rating or Duplicate Submission",
    "Verify that the system requires a star rating before submitting feedback and prevents multiple duplicate feedback entries for the same delivered order.",
    "Client is on feedback form. Order has already been reviewed once.",
    "System rejects submission without rating or disallows duplicate feedback entry.",
    "feedback,negative,validation",
    "medium", "minor", "functional", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("Open feedback modal and leave star rating unselected (0 stars).",
         "Modal open with unselected stars.",
         "Rating: 0 stars"),
        ("Click 'Submit Feedback'.",
         "System blocks submission with error: 'Please select a star rating between 1 and 5 stars.'",
         "Action: Click 'Submit Feedback'"),
        ("Attempt to submit feedback a second time on an already reviewed order.",
         "System prevents duplicate review: 'Feedback has already been submitted for this order.'",
         "Order: ORD-0012 (Already Reviewed)"),
        ("Verify database state.",
         "Only the original feedback record is preserved.",
         "Expected: Duplicate entry prevented")
    ],
    8, "Use Case 8: Feedback Management"
)

create_tc(
    53,
    "TC-53: Owner Reviews Customer Feedback, Filters by Rating, and Submits Management Response",
    "Verify that the Owner can access the Feedback Management module, filter reviews by star rating, read comments, compose an official management response, and update feedback status to 'REVIEWED'.",
    "Owner is logged into Admin Portal. Client feedback records exist.",
    "Owner response saved in database; Feedback status updated to 'REVIEWED'; notification dispatched to client.",
    "feedback,admin,response,review,csat",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Feedback Management (/admin/feedback).",
         "Feedback dashboard loads with CSAT score summary, average rating (4.8 / 5.0), and feedback list.",
         "Nav: /admin/feedback"),
        ("Filter feedback list by rating (e.g., 5-star reviews).",
         "List filters to show 5-star reviews.",
         "Filter: Rating = 5 Stars"),
        ("Select feedback FB-20260824-005 to review client comments.",
         "Feedback detail panel displays customer name, order number, driver name, and comment.",
         "Feedback: FB-20260824-005 (Client: Bacolod Bistro)"),
        ("Click 'Respond to Client' and enter official management reply.",
         "Response input area populated.",
         "Response: 'Thank you for your wonderful feedback, Bacolod Bistro! We are glad our cold-chain delivery met your high standards.'"),
        ("Click 'Post Response'.",
         "System saves response text and timestamp, updates status to 'REVIEWED', and sends alert to customer.",
         "Action: Click 'Post Response'")
    ],
    8, "Use Case 8: Feedback Management"
)

create_tc(
    54,
    "TC-54: Client Views Feedback History and Official Response from Management",
    "Verify that the Client can view their submitted feedback history along with official replies and acknowledgments from management.",
    "Client is logged into Customer Portal. Owner has responded to client feedback.",
    "Client can view the feedback card showing their original review alongside management's response.",
    "feedback,client,history,transparency,usability",
    "medium", "normal", "usability", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Customer Portal > 'My Feedback & Reviews' (/customer/feedback/history).",
         "Feedback history list renders all submitted reviews with status badges.",
         "Nav: /customer/feedback/history"),
        ("Locate reviewed order ORD-0012.",
         "Card displays original star rating, submitted date, and status badge 'Response Received'.",
         "Order: ORD-0012"),
        ("Inspect management response section.",
         "Official Owner response block is cleanly displayed below client review with responder name and timestamp.",
         "Expected: Management response displayed cleanly")
    ],
    8, "Use Case 8: Feedback Management"
)

# ==========================================
# SUITE 9: Use Case 9: Report Generation (7 Test Cases)
# ==========================================
create_tc(
    55,
    "TC-55: Generate Order & Sales Report by Date Range, Client, and Fulfillment Status",
    "Verify that the Owner can generate comprehensive order and sales reports filtered by date range, customer account, and order status (Confirmed, Delivered, Cancelled).",
    "Owner is logged into Admin Portal. Order records exist across multiple dates.",
    "System compiles and displays order volume, gross sales revenue, packaging deposit totals, and status distribution.",
    "reports,orders,sales,analytics,admin",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Reports > 'Order & Sales Reports' (/admin/reports/orders).",
         "Reports module interface loads with report category selectors and filter controls.",
         "Nav: /admin/reports/orders"),
        ("Select Date Range (e.g., '2026-08-01 to 2026-08-24').",
         "Date range picker sets timeframe.",
         "Date Range: 2026-08-01 to 2026-08-24"),
        ("Select Filter: Status = 'DELIVERED', Client = 'All Clients'.",
         "Filter parameters applied.",
         "Status: DELIVERED, Client: All Clients"),
        ("Click 'Generate Report'.",
         "System queries database, computes sales aggregation, and renders KPI cards (Total Orders, Total Cases Delivered, Gross Revenue, Bottle Deposits).",
         "Action: Click 'Generate Report'"),
        ("Inspect generated order breakdown table.",
         "Detailed order breakdown table displayed with sortable columns and line item subtotals.",
         "Expected: Order report summary table rendered")
    ],
    9, "Use Case 9: Report Generation"
)

create_tc(
    56,
    "TC-56: Generate Transportation & Fleet Delivery Performance Report (Trips, Turnaround, Delays)",
    "Verify that the Owner can generate transportation and fleet performance reports analyzing completed trips, driver on-time delivery rates, average trip duration, and vehicle utilization.",
    "Owner is logged in. Trip, driver, vehicle, and drop point records exist.",
    "Transportation report generated with trip completion metrics, fuel/distance logs, and driver performance scores.",
    "reports,transportation,fleet,trips,performance,admin",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Reports > 'Transportation & Fleet Reports'.",
         "Transportation report filter form displayed with fleet selectors.",
         "Nav: /admin/reports/transportation"),
        ("Select Date Range and Driver / Vehicle filter ('All Fleet').",
         "Parameters selected.",
         "Date Range: Last 30 Days, Fleet: All Vehicles"),
        ("Click 'Generate Transportation Report'.",
         "System aggregates data from Trip, TripDropPoint, and LocationLog tables; computes on-time delivery rate (e.g. 96.5%) and average trip duration.",
         "Action: Click 'Generate Transportation Report'"),
        ("Inspect fleet utilization chart and trip breakdown table.",
         "Report renders fleet utilization graph and trip-by-trip log with driver ratings and delivery turnaround times.",
         "Expected: Fleet performance metrics displayed")
    ],
    9, "Use Case 9: Report Generation"
)

create_tc(
    57,
    "TC-57: Generate Warehouse & Inventory Movement Report (Batch Age, Stock In/Out, Damage Discrepancy)",
    "Verify that the Owner can generate warehouse inventory reports tracking stock movements (Stock-In vs Stock-Out), batch expiration aging, inventory turnover, and damaged stock write-offs.",
    "Owner is logged in. Warehouse inventory and transaction records exist.",
    "Inventory report generated with stock movement audit, batch aging matrix, and damage scrap analysis.",
    "reports,warehouse,inventory,turnover,batch-aging,admin",
    "high", "critical", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Reports > 'Inventory & Warehouse Reports'.",
         "Inventory report builder opened with warehouse selector.",
         "Nav: /admin/reports/inventory"),
        ("Select Warehouse facility and Date Range.",
         "Parameters chosen.",
         "Warehouse: Central Cold Hub Bacolod, Date: Current Quarter"),
        ("Select Movement Type ('All Movements').",
         "Movement type filter set.",
         "Movement Type: All Movements"),
        ("Click 'Generate Inventory Report'.",
         "System aggregates StockBatch, Inventory, and InventoryTransaction tables; renders stock movement graph and batch turnover matrix.",
         "Action: Click 'Generate Inventory Report'"),
        ("Inspect batch aging breakdown and quarantine balance.",
         "Report displays shelf-life status and exact count of quarantine damaged stock.",
         "Expected: Inventory flow summary displayed")
    ],
    9, "Use Case 9: Report Generation"
)

create_tc(
    58,
    "TC-58: Generate Replacement & Defect Analysis Report by Reason and Product SKU",
    "Verify that the Owner can generate replacement reports analyzing defect rates by product SKU, defect reasons (e.g., breakage vs carbonation issue), and average replacement cycle time.",
    "Owner is logged in. Replacement records exist in system.",
    "Replacement report generated with defect Pareto analysis and supplier/handling quality insights.",
    "reports,replacements,defects,quality-control,admin",
    "medium", "normal", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Reports > 'Replacement & Defect Reports'.",
         "Replacement report builder interface loads.",
         "Nav: /admin/reports/replacements"),
        ("Select Date Range and Product Category.",
         "Criteria selected.",
         "Date: Year to Date (2026), Category: All Beverages"),
        ("Click 'Generate Replacement Report'.",
         "System processes Replacement and ReplacementLine database tables.",
         "Action: Click 'Generate Replacement Report'"),
        ("Inspect visual defect breakdown pie chart and defect Pareto metrics.",
         "Report renders defect rate per 1,000 cases delivered and identifies primary causes of product transit damage.",
         "Expected: Defect analysis charts rendered")
    ],
    9, "Use Case 9: Report Generation"
)

create_tc(
    59,
    "TC-59: Generate Client Feedback & CSAT Rating Report with Satisfaction Trends",
    "Verify that the Owner can generate customer satisfaction (CSAT) reports tracking average ratings over time, feedback volume, driver courtesy scores, and response rate metrics.",
    "Owner is logged in. Feedback records exist across historical orders.",
    "Feedback report generated with CSAT score timeline, sentiment distribution, and response time KPIs.",
    "reports,feedback,csat,customer-satisfaction,admin",
    "medium", "normal", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("Navigate to Admin Portal > Reports > 'Feedback & CSAT Reports'.",
         "Feedback report interface loaded.",
         "Nav: /admin/reports/feedback"),
        ("Select Date Range (e.g. Last 60 Days).",
         "Timeframe filter selected.",
         "Date Range: Last 60 Days"),
        ("Click 'Generate CSAT Report'.",
         "System aggregates feedback ratings, average response times, and sentiment distribution.",
         "Action: Click 'Generate CSAT Report'"),
        ("Inspect CSAT trend lines and driver rating rankings.",
         "Report renders average rating graph (4.85 / 5.0), satisfaction breakdown, and top feedback highlights.",
         "Expected: CSAT trend chart rendered")
    ],
    9, "Use Case 9: Report Generation"
)

create_tc(
    60,
    "TC-60: Apply Multi-Criteria Filters and Export Reports to CSV and PDF Formats",
    "Verify that the Owner can apply multi-criteria filtering on any generated report and export the sanitized dataset cleanly to downloadable CSV and formatted PDF files.",
    "Owner has generated an active report on screen.",
    "System exports file in CSV and PDF formats with matching filtered data and valid headers.",
    "reports,export,csv,pdf,admin",
    "high", "major", "functional", "positive", "to-be-automated", "actual", "no", "e2e",
    [
        ("On generated report page, apply secondary filter by Client name.",
         "Report table refreshes dynamically to show only matching client records.",
         "Filter: Client = 'Bacolod Bistro'"),
        ("Click 'Export as CSV'.",
         "Browser initiates download of sanitized .csv file (e.g. 'Order_Report_2026-08.csv') containing uncorrupted table rows.",
         "Action: Click 'Export as CSV'"),
        ("Click 'Export as PDF / Print'.",
         "PDF print preview opens with styled layout, CHMSU Capstone header, timestamp, and summary tables.",
         "Action: Click 'Export as PDF'"),
        ("Verify exported file contents against on-screen data.",
         "Exported files contain exactly the filtered rows and summary totals matching the UI.",
         "Expected: CSV and PDF match on-screen data")
    ],
    9, "Use Case 9: Report Generation"
)

create_tc(
    61,
    "TC-61: Export Report Handling on Empty Dataset or Invalid Date Range Filter",
    "Verify that the system gracefully handles report generation and export requests when date range is inverted (start date > end date) or when no records match the criteria.",
    "Owner is on Report Generation page.",
    "System displays 'No records found matching criteria' and prevents broken export generation.",
    "reports,negative,boundary,validation",
    "low", "minor", "boundary", "negative", "to-be-automated", "actual", "no", "e2e",
    [
        ("Enter an inverted date range where Start Date is after End Date.",
         "Date inputs receive invalid range.",
         "Start Date: 2026-12-31, End Date: 2026-01-01"),
        ("Click 'Generate Report'.",
         "System blocks query with error: 'Start date cannot be greater than End date.'",
         "Action: Click 'Generate Report'"),
        ("Set date range to future period with 0 records and attempt export.",
         "Report displays empty-state illustration: 'No records found for the selected period' and export button is disabled.",
         "Date Range: 2030-01-01 to 2030-01-31")
    ],
    9, "Use Case 9: Report Generation"
)

# ==========================================
# Write to CSV
# ==========================================
filenames = ["LMS_CFM_Qase_Test_Cases_Complete.csv", "LMS_CFM_Qase_Test_Cases.csv"]
all_rows = suite_rows + test_cases

for fname in filenames:
    try:
        with open(fname, mode='w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=headers, quoting=csv.QUOTE_MINIMAL)
            writer.writeheader()
            for r in all_rows:
                writer.writerow(r)
        print(f"Successfully generated {fname} with {len(suites)} suites and {len(test_cases)} test cases with 100% complete step parity!")
    except Exception as e:
        print(f"Notice: Could not write to {fname} ({e}). Ensure the file is closed in other programs.")

