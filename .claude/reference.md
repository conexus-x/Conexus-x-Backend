# reference: crm domain model
Sources cached offline — do not re-search. UI counterpart: app/.claude/reference.md.
Term map ours->monday: Workspace=Workspace, Module=Board, Collection=Group, Record=Item, RecordValue=Cell.
## column type catalog (monday enum | airtable enum)
text|singleLineText, long_text|multilineText, numbers|number, -|percent, -|currency, -|duration, status|singleSelect, dropdown|multipleSelects, tags|-, checkbox|checkbox, date|date, -|dateTime, timeline|-, week|-, hour|-, world_clock|-, people|singleCollaborator+multipleCollaborators, email|email, phone|phoneNumber, link|url, location|-, country|-, file|multipleAttachments, rating|rating, vote|-, color_picker|-, board_relation|multipleRecordLinks, dependency|-, subtasks|-, button|button, doc|richText, -|barcode, -|aiText.
Read-only/derived: formula|formula, mirror|multipleLookupValues, -|rollup, -|count, progress|-, auto_number|autoNumber, item_id|-, creation_log|createdBy+createdTime, last_updated|lastModifiedBy+lastModifiedTime.
Our Column.ts already has: options, statusOptions, color, width, position, isRequired, isHidden. Add `type` enum from list above + per-type `settings` subdoc.
Value storage: RecordValue.value:any — persist per-type JSON ({label,index,color} for status; {from,to} for timeline; [userIds] for people; [{url,name,size}] for files).
## crm object templates (module presets)
Leads: name, status(New/Attempting/Contacted/Qualified/Unqualified), company, title, email, phone, source, owner, last_interaction, create_contact(button).
Contacts: name, email, phone, title, account(relation), deals(relation), type, priority, owner, activities(relation), last_contacted.
Accounts: name, domain, industry, employees, hq_location, contacts(relation), deals(relation), owner, description.
Deals: name, stage(New/Discovery/Proposal/Negotiation/Won/Lost), value(currency), account(relation), contact(relation), owner, close_date, probability, source.
Activities: type(Call/Meeting/Email/Task), subject, related_to(relation), owner, due_date, status, notes.
Pipeline view = kanban on Deals.stage; weighted forecast = sum(value*probability).
## permissions
Account roles: admin | member | viewer | guest. Our WorkspaceMember.role = owner|admin|member|guest (viewer missing — add).
viewer: read + post updates, no field/structure writes. guest: only explicitly shared modules, no workspace settings.
Board-level roles: owner | editor | contributor | assigned-contributor(edit only own-assigned rows) | viewer.
Module.visibility private|workspace|public already matches monday main/shareable/private split.
Enforce: role check in controller after `protect`; owner/admin only for schema mutations (column create/delete, module delete, member role change).
## automation model (to add)
Recipe = trigger + optional conditions + actions[]. Persist as {workspace, module, trigger:{type,columnId,value}, conditions:[{columnId,op,value}], actions:[{type,params}], isActive, createdBy}.
Triggers: item_created, column_changed, status_changed_to, date_arrives(+offset), item_moved_to_group, subitem_created, every_time_period, form_submitted.
Actions: notify_person, assign_person, set_column_value, move_to_group, create_item, create_subitem, archive_item, delete_item, send_email, create_dependency, duplicate_item.
Ops for conditions: is, is_not, is_empty, is_not_empty, contains, greater_than, less_than, between.
## activity + notification semantics
Activity.ts logs every cell write: {workspace, module, record, column, user, action, before, after}. Feed = reverse-chron per record + per module.
Notification triggers: mention in update, assigned via people column, automation notify, member invited, due date approaching.
Comment.ts supports parentComment (threaded updates), edited, isDeleted — matches monday Updates tab.
## api additions implied
views CRUD (per module: type, filters, sort, hiddenColumns, groupBy, config), bulk record ops (move/duplicate/archive/delete by ids), record reorder (position), column reorder/resize, module duplicate/template instantiate, saved filters, export csv, public form endpoint (unauthenticated POST -> record), search across workspace.
src: developer.monday.com/api-reference/reference/column-types-reference; developer.monday.com/apps/docs/triggers-recipes; airtable.com/developers/web/api/field-model; support.monday.com/hc/en-us/articles/360002144900 (user types), /360019222479 (permissions), /360001222900 (automations); monday.com/crm/marketplace/template/*.
