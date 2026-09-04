'use strict';

const state = {
  user: null, csrf: '', settings: {}, riskQuestions: [], checklistItems: [], permissions: [],
  vehicles: [], drivers: [], currentView: 'dashboard', appVersion: '',
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

async function openJourneyForm(journey = null) {
  await preloadResources();
  const answerMap = Object.fromEntries((journey?.risk_answers || []).map(x=>[x.question_key,x.answer]));
  const checklistMap = Object.fromEntries((journey?.checklist_answers || []).map(x=>[x.item_key,x.confirmed]));
  const body = `<form id="journeyForm">
    <div class="wizard-tabs">${['Division','Trip Details','Vehicle & Driver','Risk','Checklist'].map((x,i)=>`<button type="button" class="wizard-tab ${i===0?'active':''}" data-step="${i}">${i+1}. ${x}</button>`).join('')}</div>
    <div class="wizard-pane active" data-pane="0"><div class="form-grid">${input('j_division','Division',journey?.division || state.user.division)}${input('j_site','Unit / Site',journey?.site || '')}<label class="full">Purpose / Reason<textarea id="j_purpose" class="field" required>${esc(journey?.purpose || '')}</textarea></label></div></div>
    <div class="wizard-pane" data-pane="1"><div class="form-grid">${input('j_from','Start Location',journey?.start_location || '')}${input('j_to','End Location',journey?.end_location || '')}${input('j_dep','Departure Date / Time',localInputDate(journey?.departure_at),'datetime-local')}${input('j_arr','Estimated Arrival',localInputDate(journey?.estimated_arrival_at),'datetime-local')}${input('j_distance','Distance (km)',journey?.distance_km || '','number')}<label>Night Drive<select id="j_night" class="field"><option value="false" ${!journey?.night_drive?'selected':''}>No</option><option value="true" ${journey?.night_drive?'selected':''}>Yes</option></select></label></div></div>
    <div class="wizard-pane" data-pane="2"><div class="form-grid"><label>Vehicle<select id="j_vehicle" class="field"><option value="">Select vehicle</option>${state.vehicles.map(v=>`<option value="${v.id}" ${journey?.vehicle_id===v.id?'selected':''}>${esc(v.plate)} — ${esc(v.model)} (${cap(v.status)})</option>`).join('')}</select></label><label>Driver<select id="j_driver" class="field"><option value="">Select driver</option>${state.drivers.map(d=>`<option value="${d.id}" ${journey?.driver_id===d.id?'selected':''}>${esc(d.name)} (${cap(d.status)})</option>`).join('')}</select></label><label>Load Type<select id="j_load" class="field">${['Passengers','Equipment','Mixed','Dangerous Goods'].map(x=>`<option ${journey?.load_type===x?'selected':''}>${x}</option>`).join('')}</select></label>${input('j_passengers','Passengers / Crew',journey?.passengers || '')}</div><div id="resourceWarnings"></div></div>
    <div class="wizard-pane" data-pane="3"><div id="riskSummary" class="risk-summary"></div><div id="riskQuestions">${state.riskQuestions.map(q=>riskQuestion(q,answerMap[q.key])).join('')}</div></div>
    <div class="wizard-pane" data-pane="4"><div class="alert">Every mandatory item must be confirmed before submission. Drafts can be saved before completion.</div>${state.checklistItems.map(item=>`<label class="check-item"><p>${esc(item.text)}</p><input type="checkbox" data-check-key="${esc(item.key)}" ${checklistMap[item.key]?'checked':''}></label>`).join('')}</div>
    <div id="journeyError" class="form-error hidden"></div>
  </form>`;
  const footer = `<button class="btn" data-close>Cancel</button><button class="btn" id="journeyDraft">Save Draft</button><button class="btn primary" id="journeySubmit">Submit Journey</button>`;
  openModal({title:journey?`Edit ${journey.journey_no}`:'Create New Journey',subtitle:'Complete the controlled journey workflow',body,footer,large:true});
  let currentStep=0;
  function setStep(step){currentStep=step;$$('.wizard-tab',$('#modalLayer')).forEach(x=>x.classList.toggle('active',+x.dataset.step===step));$$('.wizard-pane',$('#modalLayer')).forEach(x=>x.classList.toggle('active',+x.dataset.pane===step));}
  $$('.wizard-tab',$('#modalLayer')).forEach(x=>x.addEventListener('click',()=>setStep(+x.dataset.step)));
  $('#journeyDraft').addEventListener('click', e=>{e.preventDefault();saveJourney(journey,false,setStep);});
  $('#journeySubmit').addEventListener('click', e=>{e.preventDefault();saveJourney(journey,true,setStep);});
  ['j_dep','j_arr','j_night','j_load','j_driver'].forEach(id=>$('#'+id).addEventListener('change',()=>{syncDerivedRisk();updateResourceWarnings();}));
  $('#j_vehicle').addEventListener('change',updateResourceWarnings);
  $$('.toggle',$('#modalLayer')).forEach(btn=>btn.addEventListener('click',()=>selectRisk(btn)));
  syncDerivedRisk(); updateResourceWarnings(); updateRiskSummary();
}

function input(id,label,value,type='text') { return `<label>${esc(label)}<input id="${id}" class="field" type="${type}" value="${esc(value)}" ${['j_division','j_from','j_to','j_dep','j_arr','j_distance'].includes(id)?'required':''}></label>`; }
function riskQuestion(q,value) {
  return `<div class="risk-item" data-risk="${esc(q.key)}" data-weight="${q.weight}" data-derived="${q.derived?'true':'false'}"><p>${esc(q.text)}${q.derived?' <span class="subtext">Calculated from trip data</span>':''}</p><div class="toggle-group"><button type="button" class="toggle ${value===true?'selected-yes':''}" data-value="true" ${q.derived?'disabled':''}>Yes</button><button type="button" class="toggle ${value===false?'selected-no':''}" data-value="false" ${q.derived?'disabled':''}>No</button></div></div>`;
}
function selectRisk(button) { const item=button.closest('.risk-item'); $$('.toggle',item).forEach(x=>x.className='toggle'); button.classList.add(button.dataset.value==='true'?'selected-yes':'selected-no'); updateRiskSummary(); }
function setRisk(key,value) { const item=$(`[data-risk="${key}"]`,$('#modalLayer')); if(!item)return; $$('.toggle',item).forEach(x=>{x.className='toggle';if(x.dataset.value===String(value))x.classList.add(value?'selected-yes':'selected-no');}); }
function syncDerivedRisk() {
  const dep=new Date($('#j_dep').value), arr=new Date($('#j_arr').value); const driver=state.drivers.find(d=>d.id===+$('#j_driver').value);
  setRisk('night_drive',$('#j_night').value==='true'); setRisk('dangerous_goods',$('#j_load').value==='Dangerous Goods'); setRisk('over_4_hours',dep && arr && (arr-dep)>4*3600000); setRisk('driver_rest',!!driver && driver.rest_hours < (state.settings.minimum_rest_hours || 8)); updateRiskSummary();
}
function riskPayload() { return $$('.risk-item',$('#modalLayer')).map(item=>{const yes=$('.selected-yes',item),no=$('.selected-no',item);return {question_key:item.dataset.risk,answer:yes?true:no?false:null};}).filter(x=>x.answer!==null); }
function updateRiskSummary() { let score=0,max=0;$$('.risk-item',$('#modalLayer')).forEach(item=>{max+=+item.dataset.weight;if($('.selected-yes',item))score+=+item.dataset.weight;});const pct=max?score/max:0;const level=pct<.25?'low':pct<.55?'medium':'high';$('#riskSummary').innerHTML=`<div class="risk-score">${score}</div><div><span class="badge ${level}">${level} risk</span><span class="subtext">Approval path: ${level==='high'?'Manager + HSE':'Manager'}</span></div>`; }
function updateResourceWarnings() { const v=state.vehicles.find(x=>x.id===+$('#j_vehicle').value),d=state.drivers.find(x=>x.id===+$('#j_driver').value);const warnings=[];if(v&&v.status!=='active')warnings.push(`Vehicle status: ${v.status}`);if(v&&state.settings.require_gps&&v.gps_status!=='Active')warnings.push('Vehicle GPS is not active');if(d&&d.status!=='active')warnings.push(`Driver status: ${d.status}`);if(d&&d.drug_test!=='Clear')warnings.push(`Driver drug test: ${d.drug_test}`);$('#resourceWarnings').innerHTML=warnings.length?`<div class="alert danger" style="margin-top:13px">${warnings.map(esc).join(' · ')}</div>`:''; }
function journeyPayload(submit) {
  const vehicleVal = $('#j_vehicle')?.value;
  const driverVal = $('#j_driver')?.value;
  const distanceVal = $('#j_distance')?.value;

  return {
    division: $('#j_division')?.value.trim() || '',
    site: $('#j_site')?.value.trim() || '',
    purpose: $('#j_purpose')?.value.trim() || '',
    start_location: $('#j_from')?.value.trim() || '',
    end_location: $('#j_to')?.value.trim() || '',
    departure_at: $('#j_dep')?.value
      ? new Date($('#j_dep').value).toISOString()
      : null,
    estimated_arrival_at: $('#j_arr')?.value
      ? new Date($('#j_arr').value).toISOString()
      : null,

    // 🔴 حل الـ 422: تحويل الـ Strings الفارغة لـ null أو أرقام
    distance_km: distanceVal ? parseFloat(distanceVal) : 0,
    night_drive: $('#j_night')?.value === 'true',
    load_type: $('#j_load')?.value || 'Passengers',
    passengers: $('#j_passengers')?.value.trim() || '',
    vehicle_id: vehicleVal ? parseInt(vehicleVal, 10) : null,
    driver_id: driverVal ? parseInt(driverVal, 10) : null,

    submit: Boolean(submit),

    // تجميع إجابات الـ Risk والـ Checklist لو متوفرة
    risk_answers: typeof getRiskAnswersPayload === 'function' ? getRiskAnswersPayload() : [],
    checklist_answers: typeof getChecklistAnswersPayload === 'function' ? getChecklistAnswersPayload() : [],
  };
}
async function saveJourney(journey, submit, setStep) {
  const errorBox = $('#journeyError');
  errorBox.classList.add('hidden');

  // تعطيل أزرار الحفظ أثناء إرسال الطلب لمنع الضغط المكرر (Double Submit)
  const btnSubmit = $('#journeySubmit');
  const btnDraft = $('#journeyDraft');
  if (btnSubmit) btnSubmit.disabled = true;
  if (btnDraft) btnDraft.disabled = true;

  try {
    const payload = journeyPayload(submit);

    // 🔴 حل الـ 409: التأكد التام من إرسال الـ version إذا كان هناك تعديل على رحلة معينة
    if (journey && journey.id) {
      payload.version = Number(journey.version) || 1;
    }

    const isEdit = Boolean(journey && journey.id);
    const endpoint = isEdit ? `/api/journeys/${journey.id}` : '/api/journeys';
    const httpMethod = isEdit ? 'PUT' : 'POST';

    const result = await api(endpoint, {
      method: httpMethod,
      body: JSON.stringify(payload),
    });

    closeModal();
    toast(
      submit
        ? `${result.journey_no} submitted for approval.`
        : `${result.journey_no} saved as draft.`
    );
    await navigate('journeys');
  } catch (error) {
    errorBox.innerHTML = esc(error.message).replaceAll('\n', '<br>');
    errorBox.classList.remove('hidden');

    if (error.message.toLowerCase().includes('risk')) setStep(3);
    else if (error.message.toLowerCase().includes('checklist')) setStep(4);
    else if (
      error.message.toLowerCase().includes('vehicle') ||
      error.message.toLowerCase().includes('driver')
    )
      setStep(2);

    toast(error.message, 'error');
  } finally {
    // إعادة تفعيل الأزرار بعد انتهاء الطلب
    if (btnSubmit) btnSubmit.disabled = false;
    if (btnDraft) btnDraft.disabled = false;
  }
}
async function openJourneyDetail(id) {
  const [j, events] = await Promise.all([api(`/api/journeys/${id}`),api(`/api/journeys/${id}/events`)]);
  const approvals = j.approvals.map(a=>`<div class="detail-row"><span>Stage ${a.stage} · ${cap(a.required_role)}</span><span><span class="badge ${a.status==='approved'?'approved':a.status==='pending'?'pending_approval':'draft'}">${cap(a.status)}</span> ${esc(a.approver_name||'')}</span></div>`).join('') || '<p class="muted">Not submitted for approval.</p>';
  const body = `<div class="details-grid"><div class="detail-box"><div class="section-title">Journey Details</div>${detailRow('Route',`${j.start_location} → ${j.end_location}`)}${detailRow('Departure',fmtDate(j.departure_at,true))}${detailRow('Est. Arrival',fmtDate(j.estimated_arrival_at,true))}${detailRow('Distance',`${j.distance_km} km`)}${detailRow('Load',j.load_type)}${detailRow('Status',cap(j.status))}</div><div class="detail-box"><div class="section-title">Resources & Risk</div>${detailRow('Driver',j.driver?.name||'—')}${detailRow('Vehicle',j.vehicle?.plate||'—')}${detailRow('Risk',`${cap(j.risk_level)} (${j.risk_score})`)}${detailRow('Requester',j.requester.name)}${detailRow('Division',j.division)}${detailRow('Version',j.version)}</div></div><div class="detail-box" style="margin-top:13px"><div class="section-title">Purpose</div><p class="muted">${esc(j.purpose||'—')}</p></div><div class="grid-equal" style="margin-top:13px"><div class="detail-box"><div class="section-title">Approval Trail</div>${approvals}</div><div class="detail-box"><div class="section-title">Activity Timeline</div><div class="timeline">${events.items.map(e=>`<div class="timeline-item"><div class="timeline-dot">•</div><div class="timeline-body"><strong>${esc(e.actor_name)} · ${cap(e.event_type)}</strong><p>${esc(e.message)}</p><small>${fmtDate(e.created_at,true)}</small></div></div>`).join('')||'<p class="muted">No activity yet.</p>'}</div></div></div>`;
  const footer = `<button class="btn" data-close>Close</button>${canShowEdit(j)?`<button class="btn primary" id="detailEdit">Edit Journey</button>`:''}`;
  openModal({title:j.journey_no,subtitle:`${cap(j.status)} · ${cap(j.risk_level)} risk`,body,footer,large:true});
  if ($('#detailEdit')) $('#detailEdit').addEventListener('click',async()=>{closeModal();await preloadResources();openJourneyForm(j);});
}
function detailRow(label,value){return `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;}

function promptTransition(id,statusName) { const requiresReason=['cancelled','suspended'].includes(statusName);openModal({title:`${cap(statusName)} Journey`,subtitle:'This action is recorded in the permanent audit trail.',body:`<label>${requiresReason?'Reason / Comment':'Operational Comment'}<textarea id="transitionComment" class="field" style="height:90px;padding:10px" placeholder="Enter operational context"></textarea></label>`,footer:`<button class="btn" data-close>Cancel</button><button id="confirmTransition" class="btn ${statusName==='cancelled'?'danger':'primary'}">Confirm ${cap(statusName)}</button>`});$('#confirmTransition').addEventListener('click',async()=>{try{await api(`/api/journeys/${id}/transition`,{method:'POST',body:JSON.stringify({status:statusName,comment:$('#transitionComment').value.trim()})});closeModal();toast(`Journey changed to ${cap(statusName)}.`);navigate(state.currentView);}catch(e){toast(e.message,'error');}}); }
function promptCheckin(id) { openModal({title:'Log Driver Check-in',subtitle:'Confirm safety, progress and current location.',body:`<div class="form-grid">${input('ci_location','Current Location','','text')}<label class="full">Comment<textarea id="ci_comment" class="field">Driver confirmed safe and on route</textarea></label></div>`,footer:'<button class="btn" data-close>Cancel</button><button id="confirmCheckin" class="btn success">Save Check-in</button>'});$('#confirmCheckin').addEventListener('click',async()=>{try{await api(`/api/journeys/${id}/checkin`,{method:'POST',body:JSON.stringify({location:$('#ci_location').value.trim(),comment:$('#ci_comment').value.trim()})});closeModal();toast('Check-in recorded.');navigate('control');}catch(e){toast(e.message,'error');}}); }
function promptDecision(id,action){const label=action==='return'?'Return for Correction':cap(action);openModal({title:`${label} Journey`,subtitle:'Your identity and decision time will be recorded.',body:`<label>${action==='approve'?'Approval Comment (optional)':'Reason (required)'}<textarea id="decisionText" class="field" style="height:100px;padding:10px"></textarea></label>`,footer:`<button class="btn" data-close>Cancel</button><button id="confirmDecision" class="btn ${action==='approve'?'success':action==='return'?'warning':'danger'}">${label}</button>`});$('#confirmDecision').addEventListener('click',async()=>{const text=$('#decisionText').value.trim();if(action!=='approve'&&text.length<3){toast('A clear reason is required.','error');return;}const endpoint=action==='return'?'return':action;const payload=action==='approve'?{comment:text}:{reason:text};try{await api(`/api/journeys/${id}/${endpoint}`,{method:'POST',body:JSON.stringify(payload)});closeModal();toast(`Journey ${action==='return'?'returned':action+'d'}.`);navigate('approvals');}catch(e){toast(e.message,'error');}});}

function openVehicleForm(v=null){const body=`<form id="vehicleForm" class="form-grid">${input('v_plate','Plate Number',v?.plate||'')}${input('v_model','Brand / Model',v?.model||'')}${input('v_contractor','Contractor',v?.contractor||'')}${input('v_type','Vehicle Type',v?.vehicle_type||'Light')}${input('v_license','License Expiry',dateValue(v?.license_expiry),'date')}${input('v_insurance','Insurance Expiry',dateValue(v?.insurance_expiry),'date')}${input('v_inspection','Inspection Expiry',dateValue(v?.inspection_expiry),'date')}${input('v_maintenance','Maintenance Due',dateValue(v?.maintenance_due),'date')}<label>GPS Status<select id="v_gps" class="field">${['Active','Inactive','N/A'].map(x=>`<option ${v?.gps_status===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Status<select id="v_status" class="field">${['active','maintenance','blacklisted'].map(x=>`<option ${v?.status===x?'selected':''}>${cap(x)}</option>`).join('')}</select></label><label class="full">Notes<textarea id="v_notes" class="field">${esc(v?.notes||'')}</textarea></label></form>`;openModal({title:v?'Edit Vehicle':'Add Vehicle',body,footer:'<button class="btn" data-close>Cancel</button><button id="saveVehicle" class="btn primary">Save Vehicle</button>'});$('#saveVehicle').addEventListener('click',async()=>{const p={plate:$('#v_plate').value.trim(),model:$('#v_model').value.trim(),contractor:$('#v_contractor').value.trim(),vehicle_type:$('#v_type').value.trim(),license_expiry:$('#v_license').value||null,insurance_expiry:$('#v_insurance').value||null,inspection_expiry:$('#v_inspection').value||null,maintenance_due:$('#v_maintenance').value||null,gps_status:$('#v_gps').value,status:$('#v_status').value,notes:$('#v_notes').value.trim(),version:v?.version||null};try{await api(v?`/api/vehicles/${v.id}`:'/api/vehicles',{method:v?'PUT':'POST',body:JSON.stringify(p)});closeModal();toast('Vehicle saved.');renderVehicles();}catch(e){toast(e.message,'error');}});}
function openDriverForm(d=null){const body=`<form class="form-grid">${input('d_name','Full Name',d?.name||'')}${input('d_phone','Phone',d?.phone||'')}${input('d_class','License Class',d?.license_class||'Class 1')}${input('d_license','License Expiry',dateValue(d?.license_expiry),'date')}${input('d_ddc','DDC Expiry',dateValue(d?.ddc_expiry),'date')}${input('d_medical','Medical Expiry',dateValue(d?.medical_expiry),'date')}${input('d_defensive','Defensive Driving Expiry',dateValue(d?.defensive_expiry),'date')}${input('d_rest','Rest Hours',d?.rest_hours??8,'number')}<label>Drug Test<select id="d_drug" class="field">${['Clear','Pending','Failed'].map(x=>`<option ${d?.drug_test===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Status<select id="d_status" class="field"><option value="active" ${d?.status==='active'?'selected':''}>Active</option><option value="restricted" ${d?.status==='restricted'?'selected':''}>Restricted</option></select></label><label class="full">Notes<textarea id="d_notes" class="field">${esc(d?.notes||'')}</textarea></label></form>`;openModal({title:d?'Edit Driver':'Add Driver',body,footer:'<button class="btn" data-close>Cancel</button><button id="saveDriver" class="btn primary">Save Driver</button>'});$('#saveDriver').addEventListener('click',async()=>{const p={name:$('#d_name').value.trim(),phone:$('#d_phone').value.trim(),license_class:$('#d_class').value.trim(),license_expiry:$('#d_license').value||null,ddc_expiry:$('#d_ddc').value||null,medical_expiry:$('#d_medical').value||null,defensive_expiry:$('#d_defensive').value||null,drug_test:$('#d_drug').value,rest_hours:+$('#d_rest').value,status:$('#d_status').value,notes:$('#d_notes').value.trim(),version:d?.version||null};try{await api(d?`/api/drivers/${d.id}`:'/api/drivers',{method:d?'PUT':'POST',body:JSON.stringify(p)});closeModal();toast('Driver saved.');renderDrivers();}catch(e){toast(e.message,'error');}});}

function openUserForm(u=null){const body=`<form class="form-grid">${input('u_name','Full Name',u?.name||'')}${input('u_email','Email',u?.email||'','email')}${input('u_title','Title / Position',u?.title||'')}${input('u_division','Division',u?.division||'All Divisions')}<label>Role<select id="u_role" class="field">${['admin','control','approver','hse','creator','viewer'].map(x=>`<option value="${x}" ${u?.role===x?'selected':''}>${cap(x)}</option>`).join('')}</select></label><label>Status<select id="u_active" class="field"><option value="true" ${u?.active!==false?'selected':''}>Active</option><option value="false" ${u?.active===false?'selected':''}>Inactive</option></select></label>${u?'':input('u_password','Temporary Password','','password')}</form>`;openModal({title:u?'Edit User':'Add User',subtitle:'Individual login account with server-enforced permissions.',body,footer:'<button class="btn" data-close>Cancel</button><button id="saveUser" class="btn primary">Save User</button>'});$('#saveUser').addEventListener('click',async()=>{const p={name:$('#u_name').value.trim(),title:$('#u_title').value.trim(),division:$('#u_division').value.trim(),role:$('#u_role').value,active:$('#u_active').value==='true'};if(!u){p.email=$('#u_email').value.trim();p.password=$('#u_password').value;p.must_change_password=true;}try{await api(u?`/api/users/${u.id}`:'/api/users',{method:u?'PUT':'POST',body:JSON.stringify(p)});closeModal();toast('User account saved.');renderUsers();}catch(e){toast(e.message,'error');}});}
function openResetPassword(userId){openModal({title:'Reset User Password',subtitle:'All existing sessions for this user will be revoked.',body:`<label>New Temporary Password<input id="resetPassword" type="password" class="field" placeholder="At least 12 characters"></label>`,footer:'<button class="btn" data-close>Cancel</button><button id="confirmReset" class="btn danger">Reset Password</button>'});$('#confirmReset').addEventListener('click',async()=>{try{await api(`/api/users/${userId}/reset-password`,{method:'POST',body:JSON.stringify({new_password:$('#resetPassword').value,must_change_password:true})});closeModal();toast('Password reset and sessions revoked.');}catch(e){toast(e.message,'error');}});}

async function openNotifications(){try{const data=await api('/api/notifications');$('#drawerLayer').innerHTML=`<aside class="drawer"><div class="drawer-head"><strong>Notifications</strong><button class="modal-close" data-drawer-close>×</button></div><div class="drawer-body">${data.items.map(n=>`<div class="notification-item ${n.read_at?'':'unread'}" data-notification="${n.id}" data-journey="${n.journey_id||''}"><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small>${fmtDate(n.created_at,true)}</small></div>`).join('')||'<div class="panel-empty">No notifications.</div>'}</div></aside>`;updateBadge('#notificationBadge',data.items.filter(n=>!n.read_at).length);$('[data-drawer-close]').addEventListener('click',closeDrawer);$$('[data-notification]').forEach(el=>el.addEventListener('click',async()=>{await api(`/api/notifications/${el.dataset.notification}/read`,{method:'POST',body:'{}'});el.classList.remove('unread');if(el.dataset.journey){closeDrawer();openJourneyDetail(+el.dataset.journey);}}));}catch(e){toast(e.message,'error');}}
function openProfile(){openModal({title:state.user.name,subtitle:`${cap(state.user.role)} · ${state.user.email}`,body:`<div class="detail-box">${detailRow('Division',state.user.division)}${detailRow('Role',cap(state.user.role))}${detailRow('MFA',state.user.mfa_enabled?'Enabled':'Not configured')}${detailRow('Build',state.appVersion)}</div>`,footer:`<button class="btn" data-close>Close</button><button id="profileMfa" class="btn">${state.user.mfa_enabled?'Replace MFA':'Set Up MFA'}</button><button id="changePassword" class="btn">Change Password</button><button id="logoutButton" class="btn danger">Sign Out</button>`});$('#profileMfa').addEventListener('click',()=>openMfaSetup(false));$('#changePassword').addEventListener('click',()=>openChangePassword(false));$('#logoutButton').addEventListener('click',logout);}
function openChangePassword(mandatory=false){openModal({title:mandatory?'Password Change Required':'Change Password',subtitle:'Use at least 12 characters with upper, lower, number and special character.',body:`<div class="form-grid"><label class="full">Current Password<input id="currentPassword" type="password" class="field"></label><label>New Password<input id="newPassword" type="password" class="field"></label><label>Confirm New Password<input id="confirmPassword" type="password" class="field"></label></div>`,footer:`${mandatory?'':'<button class="btn" data-close>Cancel</button>'}<button id="savePassword" class="btn primary">Change Password</button>`});$('#savePassword').addEventListener('click',async()=>{if($('#newPassword').value!==$('#confirmPassword').value){toast('Passwords do not match.','error');return;}try{await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({current_password:$('#currentPassword').value,new_password:$('#newPassword').value})});state.user.must_change_password=false;closeModal();toast('Password changed successfully.');if(state.settings.require_mfa&&!state.user.mfa_enabled)setTimeout(()=>openMfaSetup(true),150);}catch(e){toast(e.message,'error');}});}
async function openMfaSetup(mandatory=false){
  try{
    const setup=await api('/api/auth/mfa/setup',{method:'POST',body:'{}'});
    openModal({title:mandatory?'MFA Setup Required':'Set Up Authenticator',subtitle:'Add this account to Microsoft Authenticator, Google Authenticator or any TOTP application.',body:`<div class="alert">Enter the secret manually in your authenticator app. The code changes every 30 seconds.</div><div class="detail-box">${detailRow('Account',state.user.email)}${detailRow('Secret',setup.secret)}</div><label style="display:block;margin-top:14px">6-digit authenticator code<input id="mfaConfirmCode" class="field" inputmode="numeric" autocomplete="one-time-code" placeholder="000000"></label><p class="subtext" style="word-break:break-all">${esc(setup.otpauth_uri)}</p>`,footer:`${mandatory?'':'<button class="btn" data-close>Cancel</button>'}<button id="confirmMfa" class="btn primary">Enable MFA</button>`});
    $('#confirmMfa').addEventListener('click',async()=>{try{const result=await api('/api/auth/mfa/confirm',{method:'POST',body:JSON.stringify({code:$('#mfaConfirmCode').value.trim()})});state.user.mfa_enabled=true;showRecoveryCodes(result.recovery_codes,mandatory);}catch(e){toast(e.message,'error');}});
  }catch(e){toast(e.message,'error');}
}
function showRecoveryCodes(codes,mandatory){openModal({title:'Save Recovery Codes',subtitle:'Each code can be used once if the authenticator is unavailable. Store them securely and do not share them.',body:`<div id="recoveryCodes" class="detail-box" style="font-family:monospace;display:grid;grid-template-columns:1fr 1fr;gap:8px">${codes.map(c=>`<strong>${esc(c)}</strong>`).join('')}</div>`,footer:'<button id="copyRecovery" class="btn">Copy Codes</button><button id="finishMfa" class="btn primary">I Saved Them</button>'});$('#copyRecovery').addEventListener('click',async()=>{await navigator.clipboard.writeText(codes.join('\n'));toast('Recovery codes copied.','info');});$('#finishMfa').addEventListener('click',()=>{closeModal();toast('Multi-factor authentication enabled.');applyIdentity();if(mandatory)navigate('dashboard');});}
async function resetUserMfa(userId){if(!confirm('Reset MFA and revoke all sessions for this user?'))return;try{await api(`/api/users/${userId}/reset-mfa`,{method:'POST',body:'{}'});toast('MFA reset and sessions revoked.');renderUsers();}catch(e){toast(e.message,'error');}}
async function logout(){try{await api('/api/auth/logout',{method:'POST',body:'{}'});}catch{}state.user=null;state.csrf='';$('#loginMfaField').classList.add('hidden');$('#loginOtp').value='';showLogin();}

document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeModal();closeDrawer();$('#sidebar').classList.remove('open');}});
initialize();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}
