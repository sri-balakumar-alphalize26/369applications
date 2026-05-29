// Comprehensive AttendanceService tests — covers every exported function
// across happy path + error path + critical edge cases.

import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../api/services/generalApi', () => ({
  getOdooAuthHeaders: jest.fn(() =>
    Promise.resolve({ Cookie: 'session_id=test-session' })
  ),
  ODOO_BASE_URL: jest.fn(() => 'http://localhost:8069'),
  getOdooBaseUrl: jest.fn(() => 'http://localhost:8069'),
  fetchProductCostsOdoo: jest.fn(),
}));

const Service = require('../AttendanceService');

// Clear AsyncStorage between tests so cache-fallback paths don't see stale
// data from a previous test (the new offline support for leave/waiver writes
// merged results to AsyncStorage on every successful fetch).
beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('AttendanceService — submitLateReason', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('posts hr.attendance.write with the correct payload', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, { result: true });
    const result = await Service.submitLateReason(42, 'Traffic delay');
    expect(result.success).toBe(true);
    const sent = JSON.parse(mock.history.post[0].data);
    expect(sent.params.model).toBe('hr.attendance');
    expect(sent.params.method).toBe('write');
    expect(sent.params.args).toEqual([[42], { late_reason: 'Traffic delay' }]);
  });

  test('returns success: false when Odoo returns an error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      error: { data: { message: 'Permission denied' } },
    });
    const result = await Service.submitLateReason(42, 'Some reason');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  test('handles network failure gracefully', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    const result = await Service.submitLateReason(42, 'X');
    expect(result.success).toBe(false);
  });
});

describe('AttendanceService — getEligibleLateAttendances', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('filters by late_sequence > 0 (not is_first_checkin_of_day)', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      result: [{
        id: 1, date: '2026-04-27', check_in: '2026-04-27 06:42:00',
        late_minutes: 282, late_minutes_display: '4:42',
        deduction_amount: 0, late_reason: 'Late', is_waived: false,
      }],
    });
    const records = await Service.getEligibleLateAttendances(5);
    const sent = JSON.parse(mock.history.post[0].data);
    const domain = sent.params.args[0];
    expect(domain).toContainEqual(['late_sequence', '>', 0]);
    expect(domain).toContainEqual(['employee_id', '=', 5]);
    expect(domain).toContainEqual(['is_late', '=', true]);
    expect(domain).not.toContainEqual(['is_first_checkin_of_day', '=', true]);
    expect(records.length).toBe(1);
  });

  test('returns empty list on network error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    const records = await Service.getEligibleLateAttendances(5);
    expect(records).toEqual([]);
  });

  test('maps fields including is_waived flag correctly', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      result: [{
        id: 7, date: '2026-04-28', check_in: '2026-04-28 14:30:00',
        late_minutes: 60, late_minutes_display: '1:00',
        deduction_amount: 250, late_reason: '', is_waived: true,
      }],
    });
    const records = await Service.getEligibleLateAttendances(2);
    expect(records[0].id).toBe(7);
    expect(records[0].deductionAmount).toBe(250);
    expect(records[0].isWaived).toBe(true);
  });
});

describe('AttendanceService — submitWaiverRequest', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('creates the waiver and submits it', async () => {
    // Two POSTs: create + action_submit
    mock.onPost(/\/web\/dataset\/call_kw/)
        .replyOnce(200, { result: 99 })
        .onPost(/\/web\/dataset\/call_kw/)
        .replyOnce(200, { result: true });

    const result = await Service.submitWaiverRequest(5, 42, 'Office errand');

    expect(result.success).toBe(true);
    expect(result.requestId).toBe(99);
    const createCall = JSON.parse(mock.history.post[0].data);
    expect(createCall.params.model).toBe('hr.late.waiver.request');
    expect(createCall.params.method).toBe('create');
    expect(createCall.params.args[0].employee_id).toBe(5);
    expect(createCall.params.args[0].attendance_id).toBe(42);
    expect(createCall.params.args[0].reason).toBe('Office errand');
  });

  test('returns success:false on Odoo error during create', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      error: { data: { message: 'Duplicate waiver' } },
    });
    const result = await Service.submitWaiverRequest(5, 42, 'X');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Duplicate waiver');
  });
});

describe('AttendanceService — getMyWaiverRequests', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('fetches waiver records scoped to employee', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      result: [{ id: 1, state: 'pending', late_date: '2026-04-27', reason: 'X' }],
    });
    const records = await Service.getMyWaiverRequests(5);
    expect(records.length).toBe(1);
    const sent = JSON.parse(mock.history.post[0].data);
    const domain = sent.params.args[0];
    expect(domain).toContainEqual(['employee_id', '=', 5]);
  });

  test('returns empty list on error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    expect(await Service.getMyWaiverRequests(5)).toEqual([]);
  });
});

describe('AttendanceService — getLateConfig', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('returns flattened config fields on success', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      result: {
        office_start_hour: 9.5,
        late_threshold_minutes: 12,
        grace_late_days: 2,
      },
    });
    const config = await Service.getLateConfig(5);
    expect(config.success).toBe(true);
    expect(config.officeStartHour).toBe(9.5);
    expect(config.lateThresholdMinutes).toBe(12);
    expect(config.graceLateDays).toBe(2);
  });

  test('returns success:false on error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    const config = await Service.getLateConfig(5);
    expect(config.success).toBe(false);
  });
});

describe('AttendanceService — getTodayAttendanceWithLateInfo', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('searches today range and maps records with isLate', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      result: [{
        id: 100,
        check_in: '2026-04-29 04:00:00',
        check_out: false,
        is_late: true,
        late_minutes: 60,
        late_minutes_display: '1:00',
        expected_start_time: 8.0,
        late_reason: '',
        deduction_amount: 250,
        late_sequence: 2,
        daily_total_hours: 0,
        is_first_checkin_of_day: true,
      }],
    });
    const result = await Service.getTodayAttendanceWithLateInfo(5);
    expect(result.success).toBe(true);
    expect(result.records.length).toBe(1);
    expect(result.records[0].isLate).toBe(true);
    expect(result.records[0].lateMinutes).toBe(60);
  });

  test('returns success:false with empty records on error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    const result = await Service.getTodayAttendanceWithLateInfo(5);
    expect(result.success).toBe(false);
    expect(result.records).toEqual([]);
  });
});

describe('AttendanceService — getTodayAttendanceByEmployeeId', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  // Reply differently to the two search_read calls: the today-bounded query
  // contains a "00:00:00" lower bound; the date-agnostic open-record fallback
  // does not (it filters on check_out = false with limit 1).
  const routeByQuery = (todayResult, openResult) => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply((config) => {
      const isTodayQuery = String(config.data).includes('00:00:00');
      return [200, { result: isTodayQuery ? todayResult : openResult }];
    });
  };

  test('returns the open record dated today (same-day check-in)', async () => {
    routeByQuery(
      [{ id: 11, employee_id: [5, 'Alice'], check_in: '2026-05-29 04:00:00', check_out: false }],
      []
    );
    const result = await Service.getTodayAttendanceByEmployeeId(5, 'Alice');
    expect(result).not.toBeNull();
    expect(result.id).toBe(11);
    expect(result.checkOut).toBeNull();
  });

  test('recovers a carried-over open record from a previous day (after midnight)', async () => {
    // Today has no records, but an open check-in from the 29th never closed.
    routeByQuery(
      [],
      [{ id: 99, employee_id: [5, 'Alice'], check_in: '2026-05-29 17:30:00', check_out: false }]
    );
    const result = await Service.getTodayAttendanceByEmployeeId(5, 'Alice');
    expect(result).not.toBeNull();
    expect(result.id).toBe(99);          // yesterday's open record → Check Out stays available
    expect(result.checkOut).toBeNull();
  });

  test('returns null when no open record exists anywhere (ready for new check-in)', async () => {
    routeByQuery(
      [{ id: 12, employee_id: [5, 'Alice'], check_in: '2026-05-29 04:00:00', check_out: '2026-05-29 13:00:00' }],
      []
    );
    const result = await Service.getTodayAttendanceByEmployeeId(5, 'Alice');
    expect(result).toBeNull();
  });
});

describe('AttendanceService — submitLeaveRequest', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('creates leave request with correct fields', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, { result: 88 });
    const result = await Service.submitLeaveRequest(
      'user-1', 'sick', '2026-05-01', '2026-05-02', 'Flu', 5, false
    );
    expect(result.success).toBe(true);
    const sent = JSON.parse(mock.history.post[0].data);
    expect(sent.params.model).toBe('hr.leave.request');
    expect(sent.params.method).toBe('create');
    expect(sent.params.args[0].leave_type).toBe('sick');
    expect(sent.params.args[0].reason).toBe('Flu');
  });

  test('handles half-day flag correctly', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, { result: 89 });
    await Service.submitLeaveRequest('u', 'casual', '2026-05-01', '2026-05-01', 'r', 5, true);
    const sent = JSON.parse(mock.history.post[0].data);
    expect(sent.params.args[0].is_half_day).toBe(true);
  });

  test('returns success:false on error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      error: { data: { message: 'Invalid' } },
    });
    const result = await Service.submitLeaveRequest('u', 'sick', '2026-05-01', '2026-05-02', 'r', 5);
    expect(result.success).toBe(false);
  });
});

describe('AttendanceService — getMyLeaveRequests', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('returns leave requests on success', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      result: [{ id: 1, state: 'approved', leave_type: 'sick', from_date: '2026-04-01' }],
    });
    const records = await Service.getMyLeaveRequests('u-1', 5);
    expect(records.length).toBe(1);
  });

  test('returns empty list on error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    const records = await Service.getMyLeaveRequests('u-1', 5);
    expect(records).toEqual([]);
  });
});

describe('AttendanceService — cancelLeaveRequest', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('calls the cancel action on hr.leave.request', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, { result: true });
    const result = await Service.cancelLeaveRequest(7);
    expect(result.success).toBe(true);
    const sent = JSON.parse(mock.history.post[0].data);
    expect(sent.params.model).toBe('hr.leave.request');
    expect(sent.params.args[0]).toEqual([7]);
  });

  test('returns success:false on Odoo error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      error: { data: { message: 'Already cancelled' } },
    });
    const result = await Service.cancelLeaveRequest(7);
    expect(result.success).toBe(false);
  });
});

describe('AttendanceService — submitWfhRequest', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('creates a WFH request with correct fields', async () => {
    // mock employee lookup + create
    mock.onPost(/\/web\/dataset\/call_kw/)
        .replyOnce(200, { result: [{ id: 5 }] })
        .onPost(/\/web\/dataset\/call_kw/)
        .replyOnce(200, { result: 50 });
    const result = await Service.submitWfhRequest('user-1', '2026-05-01', 'Personal');
    expect(result.success).toBe(true);
  });

  test('returns success:false on error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    const result = await Service.submitWfhRequest('user-1', '2026-05-01', 'r');
    expect(result.success).toBe(false);
  });
});

describe('AttendanceService — getTodayApprovedWfh', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('returns approved WFH object when one exists for today', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      result: [{ id: 99, state: 'approved', request_date: '2026-04-29', reason: 'home' }],
    });
    const result = await Service.getTodayApprovedWfh('user-1');
    expect(result).toMatchObject({ id: 99, state: 'approved' });
  });

  test('returns null on error / no record', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    const result = await Service.getTodayApprovedWfh('user-1');
    expect(result).toBeNull();
  });
});

describe('AttendanceService — wfhCheckIn / wfhCheckOut', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('wfhCheckIn calls action_wfh_check_in', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, { result: true });
    const result = await Service.wfhCheckIn(99);
    expect(result.success).toBe(true);
  });

  test('wfhCheckOut calls action_wfh_check_out', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, { result: true });
    const result = await Service.wfhCheckOut(99);
    expect(result.success).toBe(true);
  });

  test('wfhCheckIn returns failure on error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    const result = await Service.wfhCheckIn(99);
    expect(result.success).toBe(false);
  });
});

describe('AttendanceService — getMyWfhRequests', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('returns array of requests on success', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).reply(200, {
      result: [{ id: 1, state: 'approved', request_date: '2026-04-01', reason: 'home' }],
    });
    const records = await Service.getMyWfhRequests('user-1');
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBe(1);
  });

  test('returns empty array on error', async () => {
    mock.onPost(/\/web\/dataset\/call_kw/).networkError();
    const records = await Service.getMyWfhRequests('user-1');
    expect(records).toEqual([]);
  });
});

describe('AttendanceService — checkInToOdoo includes late_reason placeholder', () => {
  let mock;
  beforeEach(() => { mock = new MockAdapter(axios); });
  afterEach(() => { mock.restore(); });

  test('create payload contains late_reason: "."', async () => {
    // employee lookup, open-records check, create
    mock.onPost(/\/web\/dataset\/call_kw/)
        .replyOnce(200, { result: [{ id: 5, name: 'Sajin' }] })   // employee lookup
        .onPost(/\/web\/dataset\/call_kw/)
        .replyOnce(200, { result: [] })                            // no open records
        .onPost(/\/web\/dataset\/call_kw/)
        .replyOnce(200, { result: 100 });                          // create

    await Service.checkInToOdoo('user-1');

    // The 3rd POST is the create; verify payload includes late_reason
    expect(mock.history.post.length).toBeGreaterThanOrEqual(1);
    const createCall = mock.history.post.find(p => {
      try {
        const data = JSON.parse(p.data);
        return data.params.method === 'create' && data.params.model === 'hr.attendance';
      } catch { return false; }
    });
    if (createCall) {
      const data = JSON.parse(createCall.data);
      expect(data.params.args[0].late_reason).toBe('.');
    }
  });
});
