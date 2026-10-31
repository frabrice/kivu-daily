import type { Tone } from '../ui/kit';

// Calls after trips and branding sign-ups (migration 20261101170000).
// A Non-Insider driver who completes a trip is called: how is the app, and
// branded cars with our device get more passengers. A "yes" goes to
// Rodrigue as a sign-up: Agreed -> Contacted -> Paid -> Completed.

export const BRANDING_PRICE = 20000;
export const DEVICE_PRICE = 120000;

export type CallReason = 'first_trip' | 'first_call' | 'seven_days' | 'four_trips' | 'top_driver';
export type CallAnswer = 'both' | 'branding' | 'device' | 'thinking' | 'no';
export interface TripCall {
  id: string; platform_driver_id: number; driver_name: string | null; driver_phone: string | null; vehicle_plate: string | null;
  trip_id: number | null; trip_completed_at: string | null; trip_dispatch: string | null; trip_fare: number | null;
  reason: CallReason; trips_since: number; status: 'open' | 'done' | 'missed'; attempts: number; last_attempt_at: string | null; last_attempt_by: string | null;
  outcome: 'reached' | 'no_answer' | 'wrong_number' | null; rating: number | null; experience: string | null; problems: string | null;
  answer: CallAnswer | null; no_reason: string | null; notes: string | null; called_by: string | null; called_at: string | null;
  signup_id: string | null; missed_reason: string | null; created_at: string; context?: string | null;
}

export const REASON: Record<CallReason, string> = {
  first_trip: 'First trip ever', first_call: 'First call', seven_days: '7 days since the last call', four_trips: '4 trips since the last call', top_driver: 'Top 10 Non-Insider (one-time list)',
};
export const DISPATCH: Record<string, string> = {
  app: 'Booked in the app', auto: 'Booked in the app', passenger_triggered: 'Booked in the app', manual: 'Dispatched by us', driver_initiated: 'Walk-in (driver started it)',
};
export const ANSWER: Record<CallAnswer, { label: string; tone: Tone }> = {
  both: { label: 'Yes: branding + device', tone: 'success' },
  branding: { label: 'Yes: branding only', tone: 'success' },
  device: { label: 'Yes: device only', tone: 'success' },
  thinking: { label: 'Thinking about it', tone: 'attention' },
  no: { label: 'No', tone: 'danger' },
};
export const isYes = (a: CallAnswer | null) => a === 'both' || a === 'branding' || a === 'device';

export type SignupStatus = 'agreed' | 'contacted' | 'paid' | 'completed' | 'cancelled';
export interface SignupEvent { at: string; by: string | null; by_name: string | null; action: string; note: string | null; appointment?: string | null; amount?: number | null; account?: string | null }
export interface BrandingSignup {
  id: string; platform_driver_id: number; driver_name: string; driver_phone: string | null; vehicle_plate: string | null; platform_car_id: string | null;
  wants_branding: boolean; wants_device: boolean; price: number; status: SignupStatus; appointment_date: string | null; notes: string | null;
  source_call_id: string | null; agent_id: string | null; contacted_at: string | null; paid_at: string | null; paid_amount: number | null; paid_account: string | null;
  finance_transaction_id: string | null; completed_at: string | null; cancelled_reason: string | null; history: SignupEvent[]; created_at: string; updated_at: string;
}
export const SIGNUP_STATUS: Record<SignupStatus, { label: string; tone: Tone; next: string }> = {
  agreed: { label: 'Agreed', tone: 'attention', next: 'Call the driver: agree the payment and a date' },
  contacted: { label: 'Contacted', tone: 'info', next: 'Waiting for the payment' },
  paid: { label: 'Paid', tone: 'accent', next: 'Brand the car and install the device' },
  completed: { label: 'Completed', tone: 'success', next: 'Branded and device installed' },
  cancelled: { label: 'Not going ahead', tone: 'neutral', next: '' },
};
export const ACTION_LABEL: Record<string, string> = {
  agreed: 'Agreed on the call', contacted: 'Contacted', paid: 'Paid', completed: 'Completed', cancel: 'Not going ahead', note: 'Note',
};
export const wantsLabel = (s: Pick<BrandingSignup, 'wants_branding' | 'wants_device'>) =>
  s.wants_branding && s.wants_device ? 'Branding + device' : s.wants_branding ? 'Branding' : 'Device';

// What to say on the call (the MD's points, 31 Oct 2026).
export const PITCH = [
  'Thank them for the trip and ask how the Kivu Ride app is working for them: rate it 1 to 5, anything that bothers them.',
  'More passengers: the app gives priority to cars that are branded and have our device (meter). Branded cars with the device get more trips.',
  'Better accuracy: the device measures every trip exactly, so fares are right for them and for the passenger.',
  `Prices: branding ${BRANDING_PRICE.toLocaleString('en-US')} RWF, device ${DEVICE_PRICE.toLocaleString('en-US')} RWF (${(BRANDING_PRICE + DEVICE_PRICE).toLocaleString('en-US')} RWF both).`,
  'If they say yes, Rodrigue calls them to agree the payment and a date.',
];
