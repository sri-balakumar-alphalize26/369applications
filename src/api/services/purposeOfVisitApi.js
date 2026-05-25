import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ODOO_BASE_URL from '@api/config/odooConfig';

// Fetch purposes of visit from Odoo using JSON-RPC. The model is
// visit.purpose (shared with customer_visit). The old vehicle.purpose
// model + table still exist for backward-compatibility but are dead —
// no Odoo menu writes to it. vehicle.tracking.purpose_of_visit_id
// already references visit.purpose, so saved ids line up natively.
export const fetchPurposeOfVisitDropdown = async () => {
  try {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const cookie = await AsyncStorage.getItem('odoo_cookie');
      if (cookie) headers.Cookie = cookie;
    } catch (e) {
      // ignore
    }
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'visit.purpose',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'name'],
            order: 'name asc',
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (visit.purpose):', response.data.error);
      throw new Error('Odoo JSON-RPC error');
    }
    const purposes = response.data.result || [];
    console.log('[purposeOfVisitApi] visit.purpose.search_read — raw count from server:', purposes.length, 'names:', purposes.map(p => p.name));
    return purposes.map(item => ({
      _id: item.id,
      name: item.name || '',
    }));
  } catch (error) {
    console.error('Error fetching Purpose of Visit dropdown:', error);
    return [];
  }
};
