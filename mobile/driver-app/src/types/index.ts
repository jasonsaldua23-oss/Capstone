export type StaffRole = "SUPER_ADMIN" | "ADMIN" | "WAREHOUSE_STAFF" | "DRIVER";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  avatar?: string | null;
  role: StaffRole;
  type: "staff";
}

export interface DriverTrip {
  id: string;
  tripNumber: string;
  status: string;
  plannedStartAt?: string | null;
  actualStartAt?: string | null;
  notes?: string | null;
}
