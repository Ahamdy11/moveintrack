'use strict';

const state = {
  user: null, csrf: '', settings: {}, riskQuestions: [], checklistItems: [], permissions: [],
  vehicles: [], drivers: [], currentView: 'dashboard', appVersion: '', users: []
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const cap = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const initials = (name) => String(name || 'M').split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase();
const fmtDate = (value, withTime = false) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return new Intl.DateTimeFormat('en-GB', withTime ? {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'} : {day:'2-digit',month:'short',year:'numeric'}).format(d);
};
const localInputDate = (value) => value ? new Date(value).toISOString().slice(0,16) : '';
const dateValue = (value) => value ? String(value).slice(0,10) : '';
const has = (permission) => state.permissions.includes('*') || state.permissions.includes(permission);

async function api(path, options = {}) {
  const headers = {'Accept':'application/json', ...(options.headers || {})};
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (!['GET','HEAD'].includes((options.method || 'GET').toUpperCase()) && state.csrf) headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(path, {...options, headers, credentials:'same-origin'});
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401) showLogin();
    const detail = body?.detail ?? body ?? `Request failed (${response.status})`;
    const error = new Error(formatDetail(detail));
    error.status = response.status; error.detail = detail;
    throw error;
  }
  return body;
}

function formatDetail(detail) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(x => x.msg || JSON.stringify(x)).join('\n');
  if (detail?.errors) return [detail.message, ...detail.errors].filter(Boolean).join('\n');
  if (detail?.missing) return [detail.message, `Missing: ${detail.missing.join(', ')}`].filter(Boolean).join('\n');
  return detail?.message || JSON.stringify(detail);
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toastLayer').appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

function showLogin() {
  $('#appShell').classList.add('hidden');
  $('#loginScreen').classList.remove('hidden');
  closeModal(); closeDrawer();
}

function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
}

async function initialize() {
  try {
    const data = await api('/api/bootstrap');
    Object.assign(state, {
      user: data.user, csrf: data.csrf_token, settings: data.settings,
      riskQuestions: data.risk_questions, checklistItems: data.checklist_items,
      permissions: data.permissions, appVersion: data.app_version,
    });
    showApp(); applyIdentity(data.unread_notifications); navigate('dashboard');
    if (state.user.must_change_password) openChangePassword(true);
    else if (state.settings.require_mfa && !state.user.mfa_enabled) openMfaSetup(true);
  } catch (error) {
    showLogin();
  }
}

function applyIdentity(unread = 0) {
  $('#workspaceLabel').textContent = state.settings.workspace_name || 'Journey Operations';
  $('#sideUserName').textContent = state.user.name;
  $('#sideUserRole').textContent = state.user.role;
  $('#sideAvatar').textContent = initials(state.user.name);
  $('#topUserName').textContent = state.user.name;
  $('#topUserRole').textContent = state.user.role;
  $('#environmentBadge').textContent = 'PRODUCTION';
  $$('.admin-only').forEach(el => el.classList.toggle('hidden', !has('*')));
  $$('.permission-create').forEach(el => el.classList.toggle('hidden', !has('journey:create')));
  $$('.permission-control').forEach(el => el.classList.toggle('hidden', !has('journey:transition')));
  $$('.permission-approve').forEach(el => el.classList.toggle('hidden', !has('journey:approve')));
  $$('.permission-report').forEach(el => el.classList.toggle('hidden', !has('report:view')));
  updateBadge('#notificationBadge', unread);
}

function updateBadge(selector, count) {
  const el = $(selector); if (!el) return;
  el.textContent = count; el.classList.toggle('hidden', !count);
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#loginButton'); const errorBox = $('#loginError');
  button.disabled = true; button.textContent = 'Signing in…'; errorBox.classList.add('hidden');
  try {
    const payload = {email:$('#loginEmail').value.trim(), password:$('#loginPassword').value};
    if (!$('#loginMfaField').classList.contains('hidden')) payload.otp = $('#loginOtp').value.trim();
    const data = await api('/api/auth/login', {method:'POST', body:JSON.stringify(payload)});
    if (data.mfa_required) {
      $('#loginMfaField').classList.remove('hidden'); $('#loginOtp').focus();
      errorBox.textContent = data.message || 'Enter your authenticator code.'; errorBox.classList.remove('hidden');
      return;
    }
    $('#loginMfaField').classList.add('hidden'); $('#loginOtp').value='';
    state.user = data.user; state.csrf = data.csrf_token;
    await initialize();
  } catch (error) {
    errorBox.textContent = error.message; errorBox.classList.remove('hidden');
  } finally {
    button.disabled = false; button.textContent = 'Sign in';
  }
});

$('#mainNav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  $('#sidebar').classList.remove('open');
  navigate(button.dataset.view);
});
$('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#notificationButton').addEventListener('click', openNotifications);
$('#profileButton').addEventListener('click', openProfile);

async function navigate(view) {
  state.currentView = view === 'new' ? 'journeys' : view;
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view || (view === 'new' && el.dataset.view === 'journeys')));
  const titles = {
    dashboard:['Dashboard','Operational overview'], journeys:['Journeys','Plan, search and control movement requests'],
    control:['Control Room','Live journey follow-up and intervention'], approvals:['Approvals','Risk-based approval queue'],
    vehicles:['Vehicles','Fleet eligibility and document compliance'], drivers:['Drivers','Driver fitness and compliance'],
    users:['Users','Accounts, roles and workspace access'], reports:['Reports & Audit','Exports and permanent activity history'],
    settings:['System Center','Workspace policy and go-live readiness'],
  };
  const [title, subtitle] = titles[state.currentView] || titles.dashboard;
  $('#pageTitle').textContent = title; $('#pageSubtitle').textContent = subtitle;
  $('#content').innerHTML = '<div class="panel"><div class="panel-empty">Loading…</div></div>';
  try {
    if (view === 'new') { await preloadResources(); await openJourneyForm(); return; }
    const loaders = {dashboard:renderDashboard, journeys:renderJourneys, control:renderControl, approvals:renderApprovals, vehicles:renderVehicles, drivers:renderDrivers, users:renderUsers, reports:renderReports, settings:renderSettings};
    await (loaders[view] || renderDashboard)();
  } catch (error) {
    $('#content').innerHTML = `<div class="alert danger">${esc(error.message)}</div>`;
  }
}

async function preloadResources(force = false) {
  if (!force && state.vehicles.length && state.drivers.length) return;
  const [v, d] = await Promise.all([api('/api/vehicles'), api('/api/drivers')]);
  state.vehicles = v.items; state.drivers = d.items;
}

function hero(title, text, actions = '') {
  return `<div class="hero"><div><div class="eyebrow">Moveintrack</div><h1>${esc(title)}</h1><p>${esc(text)}</p></div><div class="hero-actions">${actions}</div></div>`;
}

function statsHtml(stats) {
  const items = [
    ['Active Journeys', stats.active, '⇄', ''], ['Pending Approval', stats.pending, '⌛', 'amber'],
    ['Overdue Check-ins', stats.overdue, '!', 'red'], ['Closed Today', stats.closed_today, '✓', 'green'],
  ];
  return `<div class="stats">${items.map(([label,value,icon,cls]) => `<div class="stat-card ${cls}"><span class="stat-icon">${icon}</span><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`).join('')}</div>`;
}

function journeyRow(j) {
  const overdue = j.overdue_minutes > 0 ? `<span class="subtext overdue-text">${j.overdue_minutes} min overdue</span>` : '';
  return `<tr>
    <td><button class="link btn ghost small" data-action="view-journey" data-id="${j.id}">${esc(j.journey_no)}</button></td>
    <td>${esc(j.requester?.name || '—')}<span class="subtext">${esc(j.division)}</span></td>
    <td>${esc(j.driver?.name || '—')}<span class="subtext">${esc(j.vehicle?.plate || '—')}</span></td>
    <td>${esc(j.start_location)} → ${esc(j.end_location)}<span class="subtext">${fmtDate(j.departure_at,true)}</span></td>
    <td><span class="badge ${esc(j.risk_level)}">${esc(j.risk_level)}</span></td>
    <td><span class="badge ${esc(j.status)}">${cap(j.status)}</span>${overdue}</td>
    <td><div class="button-row"><button class="btn small" data-action="view-journey" data-id="${j.id}">View</button>${canShowEdit(j) ? `<button class="btn small" data-action="edit-journey" data-id="${j.id}">Edit</button>`:''}</div></td>
  </tr>`;
}

function canShowEdit(j) {
  return state.user.role === 'admin' && !['departed','arrived','closed','cancelled'].includes(j.status) || (j.requester_id === state.user.id && ['draft','returned','rejected'].includes(j.status));
}

async function renderDashboard() {
  const data = await api('/api/dashboard');
  updateBadge('#overdueBadge', data.stats.overdue);
  const createAction = has('journey:create') ? '<button class="btn primary" data-action="new-journey">＋ New Journey</button>' : '';
  $('#content').innerHTML = hero(`Welcome, ${state.user.name.split(' ')[0]}`, 'A live view of journey approvals, active movements, follow-up exceptions and recent operational activity.', createAction) + statsHtml(data.stats) + `
    ${data.overdue.length ? `<div class="alert danger"><strong>Immediate attention:</strong> ${data.overdue.map(j=>esc(j.journey_no)).join(', ')} ${data.overdue.length===1?'is':'are'} overdue for check-in.</div>`:''}
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Recent Journeys</h3><button class="btn small" data-action="go-journeys">View all</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Journey</th><th>Requester</th><th>Resources</th><th>Route</th><th>Risk</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.recent.map(journeyRow).join('') || '<tr><td colspan="7">No journeys yet.</td></tr>'}</tbody></table></div></div>
      <div><div class="panel"><div class="panel-head"><h3>Approved & Upcoming</h3></div><div class="panel-body">${data.upcoming.map(j=>journeyMiniCard(j)).join('') || '<div class="panel-empty">No upcoming journeys.</div>'}</div></div></div>
    </div>`;
  bindContentActions();
}

function journeyMiniCard(j) {
  return `<div class="journey-card"><div class="journey-card-head"><button class="link btn ghost small" data-action="view-journey" data-id="${j.id}">${esc(j.journey_no)}</button><span class="badge ${esc(j.risk_level)}">${esc(j.risk_level)}</span></div><div class="journey-card-grid"><div><div class="info-label">Route</div><div class="info-value">${esc(j.start_location)} → ${esc(j.end_location)}</div></div><div><div class="info-label">Departure</div><div class="info-value">${fmtDate(j.departure_at,true)}</div></div><div><div class="info-label">Driver</div><div class="info-value">${esc(j.driver?.name || '—')}</div></div><div><div class="info-label">Vehicle</div><div class="info-value">${esc(j.vehicle?.plate || '—')}</div></div></div></div>`;
}

async function renderJourneys() {
  const params = new URLSearchParams();
  const data = await api('/api/journeys?' + params);
  const create = has('journey:create') ? '<button class="btn primary" data-action="new-journey">＋ New Journey</button>' : '';
  $('#content').innerHTML = hero('Journey Register', 'Search every request, inspect its approval trail and act according to your assigned role.', create) + `
    <div class="toolbar"><div class="search"><input id="journeySearch" class="field" placeholder="Search number, route or purpose"></div>
      <select id="journeyStatus" class="select"><option value="">All statuses</option>${['draft','pending_approval','approved','departed','suspended','arrived','closed','returned','rejected','cancelled'].map(x=>`<option value="${x}">${cap(x)}</option>`).join('')}</select>
      <select id="journeyRisk" class="select"><option value="">All risks</option><option>low</option><option>medium</option><option>high</option></select>
      <button class="btn" data-action="filter-journeys">Apply</button>${has('report:view')?'<a class="btn" href="/api/export/journeys.csv">Export CSV</a>':''}</div>
    <div class="panel"><div class="panel-head"><h3>${data.total} journey records</h3></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Journey</th><th>Requester</th><th>Resources</th><th>Route</th><th>Risk</th><th>Status</th><th>Actions</th></tr></thead><tbody id="journeyRows">${data.items.map(journeyRow).join('') || '<tr><td colspan="7">No journeys found.</td></tr>'}</tbody></table></div></div>`;
  bindContentActions();
}

async function filterJourneys() {
  const params = new URLSearchParams({q:$('#journeySearch').value.trim(), status:$('#journeyStatus').value, risk:$('#journeyRisk').value});
  const data = await api('/api/journeys?' + params);
  $('#journeyRows').innerHTML = data.items.map(journeyRow).join('') || '<tr><td colspan="7">No journeys found.</td></tr>';
  bindContentActions();
}

async function renderControl() {
  const data = await api('/api/journeys?limit=500');
  const active = data.items.filter(j => ['approved','departed','suspended','arrived'].includes(j.status));
  const overdue = active.filter(j => j.overdue_minutes > 0).length;
  updateBadge('#overdueBadge', overdue);
  $('#content').innerHTML = hero('Control Room', 'Start approved journeys, record driver check-ins, respond to exceptions and complete movements with a full audit trail.') + (overdue ? `<div class="alert danger">${overdue} journey(s) require immediate check-in follow-up.</div>` : '<div class="alert success">No overdue check-ins at this moment.</div>') + `<div>${active.map(controlCard).join('') || '<div class="panel"><div class="panel-empty">No active or approved journeys.</div></div>'}</div>`;
  bindContentActions();
}

function controlCard(j) {
  const buttons = [];
  if (j.status === 'approved') buttons.push(`<button class="btn primary small" data-action="transition" data-status="departed" data-id="${j.id}">Start Journey</button>`);
  if (j.status === 'departed') {
    buttons.push(`<button class="btn success small" data-action="checkin" data-id="${j.id}">Log Check-in</button>`);
    buttons.push(`<button class="btn primary small" data-action="transition" data-status="arrived" data-id="${j.id}">Mark Arrived</button>`);
    buttons.push(`<button class="btn warning small" data-action="transition" data-status="suspended" data-id="${j.id}">Suspend</button>`);
  }
  if (j.status === 'suspended') buttons.push(`<button class="btn primary small" data-action="transition" data-status="departed" data-id="${j.id}">Resume</button>`);
  if (j.status === 'arrived') buttons.push(`<button class="btn success small" data-action="transition" data-status="closed" data-id="${j.id}">Close Journey</button>`);
  if (['approved','departed','suspended'].includes(j.status)) buttons.push(`<button class="btn danger small" data-action="transition" data-status="cancelled" data-id="${j.id}">Cancel</button>`);
  return `<div class="journey-card"><div class="journey-card-head"><div><button class="link btn ghost small" data-action="view-journey" data-id="${j.id}">${esc(j.journey_no)}</button> <span class="badge ${j.status}">${cap(j.status)}</span> <span class="badge ${j.risk_level}">${esc(j.risk_level)}</span></div><div class="button-row">${buttons.join('')}</div></div>
    <div class="journey-card-grid"><div><div class="info-label">Route</div><div class="info-value">${esc(j.start_location)} → ${esc(j.end_location)}</div></div><div><div class="info-label">Driver / Vehicle</div><div class="info-value">${esc(j.driver?.name || '—')} / ${esc(j.vehicle?.plate || '—')}</div></div><div><div class="info-label">Next Check-in</div><div class="info-value ${j.overdue_minutes?'overdue-text':''}">${j.next_checkin_at ? fmtDate(j.next_checkin_at,true) : '—'}${j.overdue_minutes?` (${j.overdue_minutes} min late)`:''}</div></div><div><div class="info-label">Planned Arrival</div><div class="info-value">${fmtDate(j.estimated_arrival_at,true)}</div></div></div></div>`;
}

async function renderApprovals() {
  const data = await api('/api/approvals'); updateBadge('#approvalBadge', data.items.length);
  $('#content').innerHTML = hero('Approval Queue', 'Review journey details, resource compliance, risk answers and mandatory controls before approving.') + `${data.items.map(approvalCard).join('') || '<div class="panel"><div class="panel-empty">No journeys are waiting for your approval.</div></div>'}`;
  bindContentActions();
}

function approvalCard(j) {
  const pending = j.approvals.find(a => a.status === 'pending');
  return `<div class="journey-card"><div class="journey-card-head"><div><button class="link btn ghost small" data-action="view-journey" data-id="${j.id}">${esc(j.journey_no)}</button> <span class="badge ${j.risk_level}">${esc(j.risk_level)}</span><span class="subtext">Stage ${pending?.stage || '—'} · ${cap(pending?.required_role || '')}</span></div><div class="button-row"><button class="btn success" data-action="approve" data-id="${j.id}">Approve</button><button class="btn warning" data-action="return" data-id="${j.id}">Return</button><button class="btn danger" data-action="reject" data-id="${j.id}">Reject</button></div></div><div class="journey-card-grid"><div><div class="info-label">Requester</div><div class="info-value">${esc(j.requester.name)}</div></div><div><div class="info-label">Route</div><div class="info-value">${esc(j.start_location)} → ${esc(j.end_location)}</div></div><div><div class="info-label">Driver</div><div class="info-value">${esc(j.driver?.name || '—')}</div></div><div><div class="info-label">Vehicle</div><div class="info-value">${esc(j.vehicle?.plate || '—')}</div></div></div></div>`;
}

async function renderVehicles() {
  await preloadResources(true);
  const adminButton = has('*') ? '<button class="btn primary" data-action="add-vehicle">＋ Add Vehicle</button>' : '';
  $('#content').innerHTML = hero('Vehicle Register', 'Maintain eligibility, GPS status, insurance, inspection and maintenance controls for every vehicle.', adminButton) + resourceTable('vehicle');
  bindContentActions();
}

function resourceTable(type) {
  if (type === 'vehicle') return `<div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Plate</th><th>Model / Type</th><th>Contractor</th><th>Documents</th><th>GPS</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.vehicles.map(v=>`<tr><td><strong>${esc(v.plate)}</strong></td><td>${esc(v.model)}<span class="subtext">${esc(v.vehicle_type)}</span></td><td>${esc(v.contractor || '—')}</td><td>License ${fmtDate(v.license_expiry)}<span class="subtext">Insurance ${fmtDate(v.insurance_expiry)} · Inspection ${fmtDate(v.inspection_expiry)}</span></td><td>${esc(v.gps_status)}</td><td><span class="badge ${v.status}">${cap(v.status)}</span></td><td>${has('*')?`<button class="btn small" data-action="edit-vehicle" data-id="${v.id}">Edit</button>`:'—'}</td></tr>`).join('') || '<tr><td colspan="7">No vehicles configured.</td></tr>'}</tbody></table></div></div>`;
  return `<div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Driver</th><th>License</th><th>DDC / Medical</th><th>Defensive Driving</th><th>Rest</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.drivers.map(d=>`<tr><td><strong>${esc(d.name)}</strong><span class="subtext">${esc(d.phone || '—')}</span></td><td>${esc(d.license_class)}<span class="subtext">${fmtDate(d.license_expiry)}</span></td><td>DDC ${fmtDate(d.ddc_expiry)}<span class="subtext">Medical ${fmtDate(d.medical_expiry)}</span></td><td>${fmtDate(d.defensive_expiry)}</td><td>${d.rest_hours} hrs</td><td><span class="badge ${d.status}">${cap(d.status)}</span><span class="subtext">Drug test: ${esc(d.drug_test)}</span></td><td>${has('*')?`<button class="btn small" data-action="edit-driver" data-id="${d.id}">Edit</button>`:'—'}</td></tr>`).join('') || '<tr><td colspan="7">No drivers configured.</td></tr>'}</tbody></table></div></div>`;
}

async function renderDrivers() {
  await preloadResources(true);
  const adminButton = has('*') ? '<button class="btn primary" data-action="add-driver">＋ Add Driver</button>' : '';
  $('#content').innerHTML = hero('Driver Register', 'Control license class, DDC, medical fitness, defensive-driving validity, drug testing and rest hours.', adminButton) + resourceTable('driver');
  bindContentActions();
}

async function renderUsers() {
  const data = await api('/api/users');
  $('#content').innerHTML = hero('Workspace Users', 'Create individual accounts, assign operational roles and control access without relying on a corporate domain.', '<button class="btn primary" data-action="add-user">＋ Add User</button>') + `<div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Title</th><th>Division</th><th>Role</th><th>MFA</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.items.map(u=>`<tr><td><strong>${esc(u.name)}</strong><span class="subtext">${esc(u.email)}</span></td><td>${esc(u.title || '—')}</td><td>${esc(u.division)}</td><td><span class="badge ${u.role}">${cap(u.role)}</span></td><td><span class="badge ${u.mfa_enabled?'active':'draft'}">${u.mfa_enabled?'Enabled':'Not Set'}</span></td><td><span class="badge ${u.active?'active':'blacklisted'}">${u.active?'Active':'Inactive'}</span></td><td><div class="button-row"><button class="btn small" data-action="edit-user" data-id="${u.id}">Edit</button><button class="btn small" data-action="reset-user" data-id="${u.id}">Reset Password</button>${u.mfa_enabled?`<button class="btn danger small" data-action="reset-mfa" data-id="${u.id}">Reset MFA</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></div>`;
  state.users = data.items; bindContentActions();
}

async function renderReports() {
  if (has('*')) {
    const auditData = await api('/api/audit?limit=200');
    $('#content').innerHTML = hero('Reports & Audit', 'Export operational data and review immutable user actions across the product.', '<a class="btn primary" href="/api/export/journeys.csv">Export Journeys CSV</a><a class="btn" href="/api/admin/export-data">Data Snapshot</a>') + auditTable(auditData.items);
  } else {
    $('#content').innerHTML = hero('Reports', 'Export the current journey register for operational analysis and review.', '<a class="btn primary" href="/api/export/journeys.csv">Export Journeys CSV</a>') + '<div class="panel"><div class="panel-body"><p class="muted">Detailed system audit history is restricted to administrators.</p></div></div>';
  }
}

function auditTable(items) {
  return `<div class="panel"><div class="panel-head"><h3>Latest Audit Events</h3></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>IP Address</th><th>Details</th></tr></thead><tbody>${items.map(a=>`<tr><td>${fmtDate(a.created_at,true)}</td><td>${esc(a.actor_name)}</td><td>${esc(a.action)}</td><td>${esc(a.entity_type)} ${esc(a.entity_id)}</td><td>${esc(a.ip_address || '—')}</td><td><span class="subtext">${esc(JSON.stringify(a.details).slice(0,160))}</span></td></tr>`).join('') || '<tr><td colspan="6">No audit events.</td></tr>'}</tbody></table></div></div>`;
}

async function renderSettings() {
  const [config, readiness] = await Promise.all([api('/api/settings'), api('/api/readiness')]);
  state.settings = config; applyIdentity();
  $('#content').innerHTML = hero('Moveintrack System Center', 'Configure operational policy and verify the controls required before exposing the product internally and externally.') + `<div class="grid-2">
    <div class="panel"><div class="panel-head"><h3>Workspace Configuration</h3></div><div class="panel-body"><form id="settingsForm" class="form-grid">
      ${field('workspace_name','Workspace Name',config.workspace_name)}${field('company_code','Journey Prefix',config.company_code)}${field('support_email','Support Email',config.support_email,'email')}${field('timezone','Timezone',config.timezone)}
      ${field('low_checkin_minutes','Low Risk Check-in (min)',config.low_checkin_minutes,'number')}${field('medium_checkin_minutes','Medium Risk Check-in (min)',config.medium_checkin_minutes,'number')}${field('high_checkin_minutes','High Risk Check-in (min)',config.high_checkin_minutes,'number')}${field('minimum_rest_hours','Minimum Driver Rest',config.minimum_rest_hours,'number')}${field('document_warning_days','Document Warning Days',config.document_warning_days,'number')}
      <label>GPS Policy<select id="set_require_gps" class="field"><option value="true" ${config.require_gps?'selected':''}>Active GPS required</option><option value="false" ${!config.require_gps?'selected':''}>GPS not mandatory</option></select></label>
      <label>External Access MFA<select id="set_require_mfa" class="field"><option value="true" ${config.require_mfa?'selected':''}>MFA required for all active users</option><option value="false" ${!config.require_mfa?'selected':''}>MFA optional</option></select></label>
      <div class="full button-row" style="margin-top:17px"><button class="btn primary" type="submit">Save Settings</button></div>
    </form></div></div>
    <div><div class="panel"><div class="panel-head"><h3>Go-Live Readiness</h3></div><div class="panel-body"><div class="readiness"><div class="score-ring" style="--score:${readiness.score}%"><strong>${readiness.score}%</strong></div><div><strong>${readiness.ready?'Ready for controlled go-live':'Action required before go-live'}</strong><p class="muted">Build ${esc(state.appVersion)}</p></div></div><div style="margin-top:16px">${readiness.checks.map(c=>`<div class="check-row"><span>${esc(c.name)}</span><strong class="${c.ok?'ok':'not-ok'}">${c.ok?'✓':'✕'} ${esc(c.value)}</strong></div>`).join('')}</div></div></div>
      <div class="panel"><div class="panel-head"><h3>Deployment Boundary</h3></div><div class="panel-body"><div class="alert">External access must pass through HTTPS reverse proxy, public DNS and firewall rules. Do not expose port 8000 directly.</div><p class="muted">Database backup, SMTP delivery and public TLS are infrastructure controls configured outside this screen.</p></div></div></div>
    </div>`;
  $('#settingsForm').addEventListener('submit', saveSettings);
}

function field(id,label,value,type='text') { return `<label>${esc(label)}<input id="set_${id}" class="field" type="${type}" value="${esc(value ?? '')}"></label>`; }
async function saveSettings(event) {
  event.preventDefault();
  const payload = {
    workspace_name:$('#set_workspace_name').value.trim(), company_code:$('#set_company_code').value.trim(), support_email:$('#set_support_email').value.trim(), timezone:$('#set_timezone').value.trim(),
    low_checkin_minutes:+$('#set_low_checkin_minutes').value, medium_checkin_minutes:+$('#set_medium_checkin_minutes').value, high_checkin_minutes:+$('#set_high_checkin_minutes').value,
    minimum_rest_hours:+$('#set_minimum_rest_hours').value, document_warning_days:+$('#set_document_warning_days').value, require_gps:$('#set_require_gps').value==='true', require_mfa:$('#set_require_mfa').value==='true',
  };
  try { state.settings = await api('/api/settings',{method:'PUT',body:JSON.stringify(payload)}); applyIdentity(); toast('Workspace settings saved.'); await renderSettings(); } catch(error){ toast(error.message,'error'); }
}

function bindContentActions() {
  const root = $('#content'); if (root.dataset.bound) return; root.dataset.bound='1';
  root.addEventListener('click', async event => {
    const el = event.target.closest('[data-action]'); if (!el) return;
    const id = +el.dataset.id; const action = el.dataset.action;
    try {
      if (action === 'new-journey') { await preloadResources(); await openJourneyForm(); }
      if (action === 'go-journeys') navigate('journeys');
      if (action === 'filter-journeys') filterJourneys();
      if (action === 'view-journey') openJourneyDetail(id);
      if (action === 'edit-journey') { await preloadResources(); const j=await api(`/api/journeys/${id}`); openJourneyForm(j); }
      if (action === 'transition') promptTransition(id, el.dataset.status);
      if (action === 'checkin') promptCheckin(id);
      if (['approve','return','reject'].includes(action)) promptDecision(id, action);
      if (action === 'add-vehicle') openVehicleForm();
      if (action === 'edit-vehicle') openVehicleForm(state.vehicles.find(v=>v.id===id));
      if (action === 'add-driver') openDriverForm();
      if (action === 'edit-driver') openDriverForm(state.drivers.find(d=>d.id===id));
      if (action === 'add-user') openUserForm();
      if (action === 'edit-user') openUserForm(state.users.find(u=>u.id===id));
      if (action === 'reset-user') openResetPassword(id);
      if (action === 'reset-mfa') resetUserMfa(id);
    } catch(error) { toast(error.message,'error'); }
  });
}

function openModal({title, subtitle='', body='', footer='', large=false}) {
  $('#modalLayer').innerHTML = `<div class="modal-overlay"><div class="modal ${large?'large':''}"><div class="modal-head"><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-foot">${footer}</div>`:''}</div></div>`;
  $('#modalLayer').addEventListener('click', modalCloseHandler, {once:true});
}
function modalCloseHandler(event) { if (event.target.matches('[data-close],.modal-overlay')) closeModal(); else $('#modalLayer').addEventListener('click', modalCloseHandler,{once:true}); }
function closeModal() { $('#modalLayer').innerHTML=''; }
function closeDrawer() { $('#drawerLayer').innerHTML=''; }

function input(id, label, value = '', type = 'text', required = true) {
  return `<label>${esc(label)}<input id="${id}" class="field" type="${type}" value="${esc(value)}" ${required ? 'required' : ''}></label>`;
}

async function openJourneyForm(journey = null) {
  await preloadResources();
  const answerMap = Object.fromEntries((journey?.risk_answers || []).map(x=>[x.question_key,x.answer]));
  const checklistMap = Object.fromEntries((journey?.checklist_answers || []).map(x=>[x.item_key,x.confirmed]));
  
  const body = `<form id="journeyForm">
    <div class="wizard-tabs">${['Division','Trip Details','Vehicle & Driver','Risk','Checklist'].map((x,i)=>`<button type="button" class="wizard-tab ${i===0?'active':''}" data-step="${i}">${i+1}. ${x}</button>`).join('')}</div>
    
    <div class="wizard-pane active" data-pane="0">
      <div class="form-grid">
        ${input('j_division','Division',journey?.division || state.user.division)}
        ${input('j_site','Unit / Site',journey?.site || '')}
        <label class="full">Purpose / Reason<textarea id="j_purpose" class="field" required>${esc(journey?.purpose || '')}</textarea></label>
      </div>
    </div>

    <div class="wizard-pane" data-pane="1">
      <div class="form-grid">
        ${input('j_start','Start Location',journey?.start_location || '')}
        ${input('j_end','End Location',journey?.end_location || '')}
        ${input('j_departure','Departure Time',localInputDate(journey?.departure_at),'datetime-local')}
        ${input('j_arrival','Estimated Arrival',localInputDate(journey?.estimated_arrival_at),'datetime-local')}
      </div>
    </div>

    <div class="wizard-pane" data-pane="2">
      <div class="form-grid">
        <label>Vehicle<select id="j_vehicle" class="field" required><option value="">Select vehicle</option>${state.vehicles.map(v=>`<option value="${v.id}" ${journey?.vehicle_id===v.id?'selected':''}>${esc(v.plate)} - ${esc(v.model)} (${v.status})</option>`).join('')}</select></label>
        <label>Driver<select id="j_driver" class="field" required><option value="">Select driver</option>${state.drivers.map(d=>`<option value="${d.id}" ${journey?.driver_id===d.id?'selected':''}>${esc(d.name)} (${d.status})</option>`).join('')}</select></label>
      </div>
    </div>

    <div class="wizard-pane" data-pane="3">
      <div class="risk-questions">${state.riskQuestions.map(q=>`
        <div class="question-row"><span class="q-text">${esc(q.prompt)}</span>
          <div class="radio-group">
            <label><input type="radio" name="rq_${q.key}" value="yes" ${answerMap[q.key]==='yes'?'checked':''}> Yes (${q.weight_yes})</label>
            <label><input type="radio" name="rq_${q.key}" value="no" ${answerMap[q.key]==='no'||!answerMap[q.key]?'checked':''}> No</label>
          </div>
        </div>`).join('')}
      </div>
    </div>

    <div class="wizard-pane" data-pane="4">
      <div class="checklist-items">${state.checklistItems.map(c=>`
        <label class="check-item">
          <input type="checkbox" id="chk_${c.key}" ${checklistMap[c.key]?'checked':''}>
          <span>${esc(c.label)}</span>
        </label>`).join('')}
      </div>
    </div>
  </form>`;

  const footer = `<div class="button-row">
    <button type="button" class="btn" id="btnPrev" disabled>Previous</button>
    <button type="button" class="btn primary" id="btnNext">Next</button>
    <button type="button" class="btn success hidden" id="btnSubmit">Submit Request</button>
  </div>`;

  openModal({title: journey ? 'Edit Journey Plan' : 'New Journey Request', body, footer, large: true});

  let step = 0;
  const tabs = $$('.wizard-tab');
  const panes = $$('.wizard-pane');

  const updateWizard = () => {
    tabs.forEach((t, i) => t.classList.toggle('active', i === step));
    panes.forEach((p, i) => p.classList.toggle('active', i === step));
    $('#btnPrev').disabled = step === 0;
    if (step === panes.length - 1) {
      $('#btnNext').classList.add('hidden');
      $('#btnSubmit').classList.remove('hidden');
    } else {
      $('#btnNext').classList.remove('hidden');
      $('#btnSubmit').classList.add('hidden');
    }
  };

  $('#modalLayer').addEventListener('click', (e) => {
    const tab = e.target.closest('.wizard-tab');
    if (tab) { step = parseInt(tab.dataset.step); updateWizard(); }
  });

  $('#btnPrev').onclick = () => { if (step > 0) { step--; updateWizard(); } };
  $('#btnNext').onclick = () => { if (step < panes.length - 1) { step++; updateWizard(); } };
  $('#btnSubmit').onclick = async () => {
    const risk_answers = state.riskQuestions.map(q => ({
      question_key: q.key,
      answer: $(`input[name="rq_${q.key}"]:checked`)?.value || 'no'
    }));
    const checklist_answers = state.checklistItems.map(c => ({
      item_key: c.key,
      confirmed: $(`#chk_${c.key}`)?.checked || false
    }));

    const payload = {
      division: $('#j_division').value,
      site: $('#j_site').value,
      purpose: $('#j_purpose').value,
      start_location: $('#j_start').value,
      end_location: $('#j_end').value,
      departure_at: new Date($('#j_departure').value).toISOString(),
      estimated_arrival_at: new Date($('#j_arrival').value).toISOString(),
      vehicle_id: +$('#j_vehicle').value,
      driver_id: +$('#j_driver').value,
      risk_answers,
      checklist_answers
    };

    try {
      if (journey) await api(`/api/journeys/${journey.id}`, {method: 'PUT', body: JSON.stringify(payload)});
      else await api('/api/journeys', {method: 'POST', body: JSON.stringify(payload)});
      closeModal();
      toast('Journey request saved successfully.');
      navigate('journeys');
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function openJourneyDetail(id) {
  try {
    const j = await api(`/api/journeys/${id}`);
    const body = `<div class="journey-detail">
      <div class="stats-row mb-15">
        <div><strong>Status:</strong> <span class="badge ${j.status}">${cap(j.status)}</span></div>
        <div><strong>Risk:</strong> <span class="badge ${j.risk_level}">${esc(j.risk_level)}</span></div>
        <div><strong>Requester:</strong> ${esc(j.requester?.name)}</div>
      </div>
      <div class="panel mb-15">
        <div class="panel-body">
          <p><strong>Route:</strong> ${esc(j.start_location)} ➔ ${esc(j.end_location)}</p>
          <p><strong>Departure:</strong> ${fmtDate(j.departure_at, true)} | <strong>Arrival:</strong> ${fmtDate(j.estimated_arrival_at, true)}</p>
          <p><strong>Vehicle:</strong> ${esc(j.vehicle?.plate)} (${esc(j.vehicle?.model)})</p>
          <p><strong>Driver:</strong> ${esc(j.driver?.name)} (${esc(j.driver?.phone)})</p>
          <p><strong>Purpose:</strong> ${esc(j.purpose)}</p>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Audit & History Log</h3></div>
        <div class="panel-body">
          ${(j.history || []).map(h => `<div class="check-row"><span><strong>${fmtDate(h.created_at, true)}</strong> - ${esc(h.action)} by ${esc(h.actor_name)}</span><span class="subtext">${esc(h.comments || '')}</span></div>`).join('') || '<div class="muted">No history events.</div>'}
        </div>
      </div>
    </div>`;
    openModal({title: `Journey Details: ${j.journey_no}`, body, large: true});
  } catch (err) { toast(err.message, 'error'); }
}

async function promptTransition(id, nextStatus) {
  const comment = prompt(`Reason or notes for transitioning status to [${cap(nextStatus)}]:`);
  if (comment === null) return;
  try {
    await api(`/api/journeys/${id}/transition`, {method: 'POST', body: JSON.stringify({status: nextStatus, comments: comment})});
    toast(`Journey status changed to ${cap(nextStatus)}`);
    navigate(state.currentView);
  } catch (err) { toast(err.message, 'error'); }
}

async function promptCheckin(id) {
  const comment = prompt("Enter check-in details/location status:");
  if (comment === null) return;
  try {
    await api(`/api/journeys/${id}/checkin`, {method: 'POST', body: JSON.stringify({comments: comment})});
    toast('Check-in logged successfully');
    navigate(state.currentView);
  } catch (err) { toast(err.message, 'error'); }
}

async function promptDecision(id, action) {
  const comment = prompt(`Enter comments for decision [${cap(action)}]:`);
  if (comment === null) return;
  try {
    await api(`/api/journeys/${id}/approval`, {method: 'POST', body: JSON.stringify({decision: action, comments: comment})});
    toast(`Journey approval ${action}ed`);
    navigate('approvals');
  } catch (err) { toast(err.message, 'error'); }
}

function openVehicleForm(vehicle = null) {
  const body = `<form id="vForm" class="form-grid">
    ${input('v_plate','Plate Number',vehicle?.plate||'')}
    ${input('v_model','Model',vehicle?.model||'')}
    ${input('v_type','Type',vehicle?.vehicle_type||'')}
    ${input('v_contractor','Contractor',vehicle?.contractor||'', 'text', false)}
    ${input('v_lic','License Expiry',dateValue(vehicle?.license_expiry),'date')}
    ${input('v_ins','Insurance Expiry',dateValue(vehicle?.insurance_expiry),'date')}
    ${input('v_insp','Inspection Expiry',dateValue(vehicle?.inspection_expiry),'date')}
    <label>GPS Status<select id="v_gps" class="field"><option value="active" ${vehicle?.gps_status==='active'?'selected':''}>Active</option><option value="inactive" ${vehicle?.gps_status==='inactive'?'selected':''}>Inactive</option></select></label>
    <label>Status<select id="v_status" class="field"><option value="active" ${vehicle?.status==='active'?'selected':''}>Active</option><option value="maintenance" ${vehicle?.status==='maintenance'?'selected':''}>Maintenance</option><option value="inactive" ${vehicle?.status==='inactive'?'selected':''}>Inactive</option></select></label>
  </form>`;
  
  openModal({
    title: vehicle ? 'Edit Vehicle' : 'Add New Vehicle',
    body,
    footer: `<button class="btn primary" id="saveV">Save Vehicle</button>`
  });

  $('#saveV').onclick = async () => {
    const payload = {
      plate: $('#v_plate').value, model: $('#v_model').value, vehicle_type: $('#v_type').value,
      contractor: $('#v_contractor').value, license_expiry: $('#v_lic').value,
      insurance_expiry: $('#v_ins').value, inspection_expiry: $('#v_insp').value,
      gps_status: $('#v_gps').value, status: $('#v_status').value
    };
    try {
      if (vehicle) await api(`/api/vehicles/${vehicle.id}`, {method:'PUT', body:JSON.stringify(payload)});
      else await api('/api/vehicles', {method:'POST', body:JSON.stringify(payload)});
      closeModal(); toast('Vehicle saved.'); renderVehicles();
    } catch(err) { toast(err.message, 'error'); }
  };
}

function openDriverForm(driver = null) {
  const body = `<form id="dForm" class="form-grid">
    ${input('d_name','Full Name',driver?.name||'')}
    ${input('d_phone','Phone',driver?.phone||'')}
    ${input('d_lic_cls','License Class',driver?.license_class||'Heavy')}
    ${input('d_lic_exp','License Expiry',dateValue(driver?.license_expiry),'date')}
    ${input('d_ddc_exp','DDC Expiry',dateValue(driver?.ddc_expiry),'date')}
    ${input('d_med_exp','Medical Expiry',dateValue(driver?.medical_expiry),'date')}
    ${input('d_def_exp','Defensive Expiry',dateValue(driver?.defensive_expiry),'date')}
    ${input('d_rest','Rest Hours',driver?.rest_hours||12,'number')}
    <label>Status<select id="d_status" class="field"><option value="active" ${driver?.status==='active'?'selected':''}>Active</option><option value="suspended" ${driver?.status==='suspended'?'selected':''}>Suspended</option></select></label>
  </form>`;

  openModal({
    title: driver ? 'Edit Driver' : 'Add New Driver',
    body,
    footer: `<button class="btn primary" id="saveD">Save Driver</button>`
  });

  $('#saveD').onclick = async () => {
    const payload = {
      name: $('#d_name').value, phone: $('#d_phone').value, license_class: $('#d_lic_cls').value,
      license_expiry: $('#d_lic_exp').value, ddc_expiry: $('#d_ddc_exp').value,
      medical_expiry: $('#d_med_exp').value, defensive_expiry: $('#d_def_exp').value,
      rest_hours: +$('#d_rest').value, status: $('#d_status').value
    };
    try {
      if (driver) await api(`/api/drivers/${driver.id}`, {method:'PUT', body:JSON.stringify(payload)});
      else await api('/api/drivers', {method:'POST', body:JSON.stringify(payload)});
      closeModal(); toast('Driver saved.'); renderDrivers();
    } catch(err) { toast(err.message, 'error'); }
  };
}

function openUserForm(user = null) {
  const body = `<form id="uForm" class="form-grid">
    ${input('u_name','Full Name',user?.name||'')}
    ${input('u_email','Email',user?.email||'','email')}
    ${input('u_title','Job Title',user?.title||'', 'text', false)}
    ${input('u_div','Division',user?.division||'Operations')}
    <label>Role<select id="u_role" class="field">
      <option value="requester" ${user?.role==='requester'?'selected':''}>Requester</option>
      <option value="approver" ${user?.role==='approver'?'selected':''}>Approver</option>
      <option value="controller" ${user?.role==='controller'?'selected':''}>Controller</option>
      <option value="admin" ${user?.role==='admin'?'selected':''}>Admin</option>
    </select></label>
    ${!user ? input('u_pass','Temporary Password','','password') : ''}
  </form>`;

  openModal({
    title: user ? 'Edit User' : 'Add New User',
    body,
    footer: `<button class="btn primary" id="saveU">Save User</button>`
  });

  $('#saveU').onclick = async () => {
    const payload = {
      name: $('#u_name').value, email: $('#u_email').value, title: $('#u_title').value,
      division: $('#u_div').value, role: $('#u_role').value
    };
    if (!user) payload.password = $('#u_pass').value;
    try {
      if (user) await api(`/api/users/${user.id}`, {method:'PUT', body:JSON.stringify(payload)});
      else await api('/api/users', {method:'POST', body:JSON.stringify(payload)});
      closeModal(); toast('User account saved.'); renderUsers();
    } catch(err) { toast(err.message, 'error'); }
  };
}

async function openResetPassword(id) {
  const pass = prompt("Enter new temporary password for user:");
  if (!pass) return;
  try {
    await api(`/api/users/${id}/reset-password`, {method: 'POST', body: JSON.stringify({password: pass})});
    toast('Password reset successfully');
  } catch (err) { toast(err.message, 'error'); }
}

async function resetUserMfa(id) {
  if (!confirm("Are you sure you want to reset MFA for this user?")) return;
  try {
    await api(`/api/users/${id}/reset-mfa`, {method: 'POST'});
    toast('MFA reset successfully');
    renderUsers();
  } catch (err) { toast(err.message, 'error'); }
}

function openNotifications() {
  openModal({title: 'Notifications', body: '<div class="panel-empty">No unread notifications.</div>'});
}

function openProfile() {
  const body = `<div class="form-grid">
    <div><strong>Name:</strong> ${esc(state.user.name)}</div>
    <div><strong>Email:</strong> ${esc(state.user.email)}</div>
    <div><strong>Role:</strong> ${esc(state.user.role)}</div>
    <div><strong>Division:</strong> ${esc(state.user.division)}</div>
  </div>`;
  openModal({
    title: 'User Profile',
    body,
    footer: `<button class="btn primary" onclick="openChangePassword()">Change Password</button>`
  });
}

function openChangePassword(forced = false) {
  const body = `<form id="pwdForm" class="form-grid">
    ${input('p_old','Current Password','','password')}
    ${input('p_new','New Password','','password')}
  </form>`;
  openModal({
    title: forced ? 'Password Change Required' : 'Change Password',
    body,
    footer: `<button class="btn primary" id="savePwd">Update Password</button>`
  });

  $('#savePwd').onclick = async () => {
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({old_password: $('#p_old').value, new_password: $('#p_new').value})
      });
      closeModal(); toast('Password changed successfully');
      state.user.must_change_password = false;
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openMfaSetup(forced = false) {
  api('/api/auth/mfa-setup').then(data => {
    const body = `<div class="text-center">
      <p>Scan this QR code with your authenticator app:</p>
      <img src="${data.qr_code}" alt="MFA QR Code" style="max-width:200px;margin:10px auto;display:block;">
      ${input('mfa_code','Verification Code','','text')}
    </div>`;
    openModal({
      title: 'Setup MFA Authenticator',
      body,
      footer: `<button class="btn primary" id="saveMfa">Verify & Enable</button>`
    });

    $('#saveMfa').onclick = async () => {
      try {
        await api('/api/auth/mfa-verify', {
          method: 'POST',
          body: JSON.stringify({code: $('#mfa_code').value, secret: data.secret})
        });
        closeModal(); toast('MFA configured successfully');
        state.user.mfa_enabled = true;
      } catch (err) { toast(err.message, 'error'); }
    };
  }).catch(err => toast(err.message, 'error'));
}

window.addEventListener('DOMContentLoaded', initialize);