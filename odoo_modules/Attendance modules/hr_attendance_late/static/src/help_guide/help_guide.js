/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart, xml } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";

// The card popup listing the help documents.
export class HelpGuideDialog extends Component {
    static components = { Dialog };
    static template = "hr_attendance_late.HelpGuideDialog";
    static props = { close: { type: Function, optional: true } };

    setup() {
        this.orm = useService("orm");
        this.state = useState({ docs: [], loaded: false });
        onWillStart(async () => {
            this.state.docs = await this.orm.searchRead(
                "attendance.help.document",
                [["active", "=", true]],
                ["name", "description", "icon"],
                { order: "sequence, id" }
            );
            this.state.loaded = true;
        });
    }

    openGuide(id) {
        // Opens the HTML guide page (with the embedded PDF + "Open in PDF doc" button).
        window.open("/attendance_help/guide/" + id, "_blank");
    }
}

// Menu client action: opens the dialog, then returns to the previous screen on close.
export class HelpGuideClientAction extends Component {
    static template = xml`<div class="o_hidden"/>`;
    setup() {
        const dialog = useService("dialog");
        const action = useService("action");
        dialog.add(
            HelpGuideDialog,
            {},
            { onClose: () => action.doAction({ type: "ir.actions.act_window_close" }) }
        );
    }
}

registry.category("actions").add("attendance_help_guide", HelpGuideClientAction);
