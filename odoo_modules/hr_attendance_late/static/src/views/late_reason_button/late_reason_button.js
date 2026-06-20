/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardWidgetProps } from "@web/views/widgets/standard_widget_props";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";
import { formatFloatTime } from "@web/views/fields/formatters";
import { serializeDateTime } from "@web/core/l10n/dates";
import { _t } from "@web/core/l10n/translation";

// Popup that captures the late reason and writes it back to the IN-MEMORY
// record only (record.update) — it never triggers a server save. This is the
// whole point: a brand-new late attendance can get its reason BEFORE the first
// save, so the `_check_late_reason_required` Python constraint (which runs on
// save) passes instead of deadlocking. The old `type="object"` button
// auto-saved the record first, which hit the constraint before the wizard
// could even open. The dialog body mirrors the old server wizard's layout.
export class LateReasonDialog extends Component {
    static template = "hr_attendance_late.LateReasonDialog";
    static components = { Dialog };
    static props = {
        close: Function,
        title: { type: String, optional: true },
        showInfo: { type: Boolean, optional: true },
        info: { type: Object, optional: true },
        defaultReason: { type: String, optional: true },
        onConfirm: Function,
    };

    setup() {
        this.state = useState({ reason: this.props.defaultReason || "" });
    }

    get canSave() {
        return !!this.state.reason.trim();
    }

    async onSave() {
        if (!this.canSave) {
            return;
        }
        await this.props.onConfirm(this.state.reason.trim());
        this.props.close();
    }
}

export class LateReasonButton extends Component {
    static template = "hr_attendance_late.LateReasonButton";
    static props = { ...standardWidgetProps };

    setup() {
        this.dialog = useService("dialog");
        this.orm = useService("orm");
    }

    get isVisible() {
        const d = this.props.record.data;
        // Hidden once checked out (form is read-only) and for waived / on-time.
        return (d.is_late || (d.late_minutes || 0) > 0) && !d.is_waived && !d.check_out;
    }

    get hasReason() {
        const r = this.props.record.data.late_reason;
        return !!(r && r.trim());
    }

    get buttonLabel() {
        return this.hasReason ? _t("Update Reason") : _t("Enter Late Reason");
    }

    async onClick() {
        const record = this.props.record;
        const d = record.data;

        // Update mode: a reason already exists -> just edit it. No detail box,
        // no preview RPC; show only the existing reason in the textarea.
        if (this.hasReason) {
            this.dialog.add(LateReasonDialog, {
                title: _t("Update Late Reason"),
                showInfo: false,
                info: {},
                defaultReason: d.late_reason || "",
                onConfirm: (reason) => record.update({ late_reason: reason }),
            });
            return;
        }

        const emp = d.employee_id;
        const employeeName = Array.isArray(emp)
            ? emp[1]
            : (emp && (emp.display_name || emp.name)) || "";
        const empId = Array.isArray(emp) ? emp[0] : emp && emp.id;

        // Defaults from the in-memory record. late_sequence / deduction_amount
        // are stored computes that only run server-side after save, so on a NEW
        // record they read 0 — fetch a no-save preview to show the real values.
        let lateSequence = d.late_sequence || 0;
        let deduction = d.deduction_amount || 0;
        let lateDisplay = d.late_minutes_display || "";
        let expectedStart = d.expected_start_time || 0;
        let session = d.checkin_session || "";

        if (empId && d.check_in) {
            try {
                const preview = await this.orm.call("hr.attendance", "preview_late_info", [
                    empId,
                    serializeDateTime(d.check_in),
                ]);
                if (preview && Object.keys(preview).length) {
                    lateSequence = preview.late_sequence ?? lateSequence;
                    deduction = preview.deduction_amount ?? deduction;
                    lateDisplay = preview.late_minutes_display || lateDisplay;
                    expectedStart = preview.expected_start_time ?? expectedStart;
                    session = preview.checkin_session || session;
                }
            } catch {
                // Network/preview failure — fall back to the form's values.
            }
        }

        const info = {
            employeeName: employeeName,
            lateDisplay: lateDisplay,
            session: session ? _t("Session %s", session) : "",
            expectedStart: formatFloatTime(expectedStart || 0),
            lateSequence: lateSequence,
            deduction: (deduction || 0).toFixed(2),
        };
        this.dialog.add(LateReasonDialog, {
            title: _t("Enter Late Reason"),
            showInfo: true,
            info: info,
            defaultReason: d.late_reason || "",
            onConfirm: (reason) => record.update({ late_reason: reason }),
        });
    }
}

export const lateReasonButton = {
    component: LateReasonButton,
};

registry.category("view_widgets").add("late_reason_button", lateReasonButton);
