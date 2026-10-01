export type Role = 'ADMIN' | 'DRIVER';

export type User = { id: string; email: string | null; role: Role };

export type DriverProfile = {
  id: string;
  name: string;
  phone: string | null;
  status: 'AVAILABLE' | 'ON_DUTY' | 'OFF';
  type: string | null;
};

export type TripStatus = 'SCHEDULED' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export type Contact = { name: string; phone: string | null };

export type Trip = {
  id: string;
  order_id: string;
  order_code: string | null;
  status: TripStatus;
  accepted_at: string | null;
  service_date: string | null;
  start_at: string | null;
  end_at: string | null;
  pickup_location: string;
  dropoff_location: string;
  service_kind: string | null;
  service_package: string | null;
  notes: string | null;
  order_notes: string | null;
  passenger_count: number | null;
  customer: Contact;
  other_customers: Contact[];
  car: { plate_number: string; model: string } | null;
  actual_start_at: string | null;
  actual_pickup_at: string | null;
  trip_finished_at: string | null;
  report_count: number;
};

export type ReportType =
  | 'ODOMETER_START'
  | 'ODOMETER_END'
  | 'FUEL'
  | 'TOLL'
  | 'PARKING'
  | 'OTHER_COST'
  | 'PHOTO'
  | 'NOTE';

export type Report = {
  id: string;
  report_type: ReportType | string;
  notes: string | null;
  file_url: string | null;
  amount: number | null;
  created_at: string;
  /** Rows the server writes itself (START / ARRIVE_CUSTOMER / FINISH). Not shown to the driver. */
  is_system?: boolean;
};

export type Expense = {
  id: string;
  type: 'FUEL' | 'TOLL' | 'PARKING' | 'OTHER';
  amount: number;
  note: string | null;
  created_at: string;
};

export type TripDetail = Trip & { reports: Report[]; expenses: Expense[] };
