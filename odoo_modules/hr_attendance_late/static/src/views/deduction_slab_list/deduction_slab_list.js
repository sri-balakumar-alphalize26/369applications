/** @odoo-module **/

import { registry } from "@web/core/registry";
import { listView } from "@web/views/list/list_view";
import { ListController } from "@web/views/list/list_controller";

// Custom list view for Deduction Slabs that shows an always-visible yellow
// banner above the rows explaining when the slabs are used. Enabled via
// js_class="deduction_slab_list" on the slab list view.
export class DeductionSlabListController extends ListController {}
DeductionSlabListController.template = "hr_attendance_late.DeductionSlabListView";

registry.category("views").add("deduction_slab_list", {
    ...listView,
    Controller: DeductionSlabListController,
});
