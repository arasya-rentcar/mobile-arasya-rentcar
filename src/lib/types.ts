export type Role = 'ADMIN' | 'DRIVER';

export type User = { id: string; email: string | null; role: Role };

export type DriverProfile = {
  id: string;
  name: string;
  phone: string | null;
  status: 'AVAILABLE' | 'ON_DUTY' | 'OFF';
  type: string | null;
  /** The driver's e-toll card as the office recorded it, e.g. "Mandiri 6032 ••••1234". Older servers do not send it. */
  etoll_card?: string | null;
};

export type TripStatus = 'SCHEDULED' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export type Contact = { name: string; phone: string | null };

export type Trip = {
  id: string;
  order_id: string;
  order_code: string | null;
  status: TripStatus;
  /**
   * When the driver pressed "Terima tugas" (the server's `driver_accepted_at`). ASSIGNED only
   * means the office gave the day a driver; it is not an acceptance.
   */
  accepted_at: string | null;
  /** Same value under the column's own name, in case a server sends it that way. */
  driver_accepted_at?: string | null;
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
  /**
   * The customer got in and the trip with them began ("Mulai perjalanan"). Null = not yet;
   * undefined = an older server without this step.
   */
  customer_onboard_at?: string | null;
  trip_finished_at: string | null;
  report_count: number;
  /**
   * The order is paid in full, so the trip with the customer may begin ("Mulai perjalanan").
   * Driving to the pickup is always allowed. Older servers do not send it.
   */
  payment_ready?: boolean;
};

export type ReportType =
  | 'ODOMETER_START'
  | 'ODOMETER_END'
  | 'FUEL'
  | 'TOLL'
  | 'PARKING'
  | 'OTHER_COST'
  | 'PHOTO'
  | 'NOTE'
  | 'ARRIVAL_PHOTO';

/** GPS fix sent with the arrival photo and the "sampai di lokasi jemput" step. */
export type GpsFix = {
  latitude: number;
  longitude: number;
  /** Metres; null when the phone did not say. */
  accuracy: number | null;
  /** When the fix was taken (ISO). */
  at: string;
  /** Android reported the fix came from a mock-location app. */
  mocked?: boolean;
  /** Short place name from the phone's reverse geocoder (null/absent when unknown or offline). */
  name?: string | null;
};

export type Report = {
  id: string;
  report_type: ReportType | string;
  notes: string | null;
  file_url: string | null;
  amount: number | null;
  created_at: string;
  /** Rows the server writes itself (START / ARRIVE_CUSTOMER / ONBOARD / FINISH). Not shown to the driver. */
  is_system?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  location_accuracy_m?: number | null;
  /** Place name the phone looked up for the coordinates (shown above them). */
  location_name?: string | null;
};

export type Expense = {
  id: string;
  type: 'FUEL' | 'TOLL' | 'PARKING' | 'OTHER';
  amount: number;
  note: string | null;
  /** The office checks every receipt; only approved costs are reimbursed. */
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** Why a cost was rejected. */
  review_note?: string | null;
  created_at: string;
};

export type TripDetail = Trip & { reports: Report[]; expenses: Expense[] };

export type NotificationType =
  | 'trip_assigned'
  | 'trip_updated'
  | 'trip_reminder'
  | 'order_paid'
  | 'payable_paid'
  | 'expense_rejected'
  | string;

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: { line_id?: string; total?: number; [key: string]: unknown } | null;
  read: boolean;
  created_at: string;
};

export type NotificationPage = { unread: number; items: AppNotification[] };

export type DriverRequestType = 'ETOLL_TOPUP';

/** Something the driver asks the office for (now: an e-toll top-up). */
export type DriverRequest = {
  id: string;
  type: DriverRequestType | string;
  card_label: string | null;
  /** Remaining balance in rupiah the driver typed (Decimal on the server, may come as a string). */
  balance: number | string | null;
  note: string | null;
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  created_at: string;
  handled_at: string | null;
  handled_note: string | null;
};

/** `POST /driver/requests`: the request, and whether an open one of the same type already existed. */
export type DriverRequestResult = { request: DriverRequest; already_open?: boolean };
