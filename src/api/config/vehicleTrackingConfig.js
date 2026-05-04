// src/api/config/vehicleTrackingConfig.js
// Uses the same Odoo server as the main app (odooConfig.js)

import getOdooBaseUrl, { DEFAULT_ODOO_DB, DEFAULT_USERNAME, DEFAULT_PASSWORD } from './odooConfig';

const DEFAULT_VEHICLE_TRACKING_DB = DEFAULT_ODOO_DB;
const DEFAULT_VEHICLE_TRACKING_USERNAME = DEFAULT_USERNAME;
const DEFAULT_VEHICLE_TRACKING_PASSWORD = DEFAULT_PASSWORD;

export {
  DEFAULT_VEHICLE_TRACKING_DB,
  DEFAULT_VEHICLE_TRACKING_USERNAME,
  DEFAULT_VEHICLE_TRACKING_PASSWORD,
};

// Default export is the getter function — callers must invoke it: VEHICLE_TRACKING_BASE_URL()
export default getOdooBaseUrl;
