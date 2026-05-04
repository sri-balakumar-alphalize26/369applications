import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ODOO_BASE_URL from '@api/config/odooConfig';

// Fetch purposes of visit from Odoo using JSON-RPC (model: vehicle.purpose)
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
          model: 'vehicle.purpose',
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
      console.error('Odoo JSON-RPC error (vehicle.purpose):', response.data.error);
      throw new Error('Odoo JSON-RPC error');
    }
    const purposes = response.data.result || [];
    return purposes.map(item => ({
      _id: item.id,
      name: item.name || '',
    }));
  } catch (error) {
    console.error('Error fetching Purpose of Visit dropdown:', error);
    return [];
  }
};
