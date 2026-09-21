/*
# Free the vehicle seat when a driver's contract ends

EndContractDrawer set contract_status = 'ended' and stage = 'inactive'
but never cleared vehicle_id/shift, so a terminated driver kept showing
as assigned on the Vehicles page and counted toward "vehicle full" /
"shift taken" checks in DriverDrawer indefinitely - confirmed live: both
already-ended drivers (Tuyishime Robert, Gatore Willard) still had a
vehicle_id and shift set. The app code is fixed in this same change
(EndContractDrawer now clears both going forward); this is the one-time
backfill for the two drivers already ended before that fix existed.
*/

UPDATE drivers SET vehicle_id = NULL, shift = NULL
WHERE contract_status = 'ended' AND vehicle_id IS NOT NULL;
