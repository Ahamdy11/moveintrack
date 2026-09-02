/* ==========================================================================
   GLOBAL STATE & UTILITY FUNCTIONS
   ========================================================================== */

const state = {
  user: null,
  currentView: 'dashboard',
  journeys: [],
  vehicles: [],
  drivers: [],
  users: [],
  riskQuestions: [],
  checklistItems: [],
  systemSettings: {},
  notifications: []
};

// Utility Selector Helpers
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// Utility Formatting & Escaping
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cap(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function fmtDate(dateStr, showTime = false) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const opts = { year: 'numeric', month: 'short', day: 'numeric' };
  if (showTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }
  return d.toLocaleDateString('en-US', opts);
}

function dateValue(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}

function localInputDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

function input(id, label, value = '', type = 'text', required = true) {
  return `
    <label style="display:block; margin-bottom:12px;">
      <span style="font-size:0.85rem; color:var(--muted); font-weight:600;">${esc(label)}${required ? ' *' : ''}</span>
      <input id="${id}" type="${type}" class="field" value="${esc(value)}" ${required ? 'required' : ''} style="width:100%; margin-top:4px;">
    </label>
  `;
}

// Toast Notifications
function toast(message, type = 'info') {
  const container = $('#toastLayer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerText = message;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 4000);
}

// Modal Layer Handling
function openModal({ title, body, footer = '', large = false }) {
  const layer = $('#modalLayer');
  if (!layer) return;
  layer.innerHTML = `
    <div class="modal-overlay" data-close="true">
      <div class="modal-card ${large ? 'large' : ''}">
        <div class="modal-header">
          <h3>${esc(title)}</h3>
          <button class="icon-button" data-close="true">&times;</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    </div>
  `;
}

function closeModal() {
  const layer = $('#modalLayer');
  if (layer) layer.innerHTML = '';
}

/* ==========================================================================
   API HTTP ENGINE
   ========================================================================== */

async function api(endpoint, options = {}) {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  options.headers = { ...defaultHeaders, ...options.headers };

  try {
    const res = await fetch(endpoint, options);
    if (res.status === 401) {
      state.user = null;
      showLoginScreen();
      throw new Error('Session expired. Please sign in again.');
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'An unexpected error occurred.');
    }
    return data;
  } catch (err) {
    throw err;
  }
}

/* ==========================================================================
   APP INITIALIZATION & NAVIGATION
   ========================================================================== */

async function initialize() {
  try {
    const user = await api('/api/auth/me');
    state.user = user;
    showAppShell();
    navigate('dashboard');
  } catch (e) {
    showLoginScreen();
  }
}

function showLoginScreen() {
  $('#loginScreen')?.classList.remove('hidden');
  $('#appShell')?.classList.add('hidden');
}

function showAppShell() {
  $('#loginScreen')?.classList.add('hidden');
  $('#appShell')?.classList.remove('hidden');
  
  if (state.user) {
    $('#sideUserName').innerText = state.user.name;
    $('#sideUserRole').innerText = cap(state.user.role);
    $('#sideAvatar').innerText = state.user.name.charAt(0).toUpperCase();
    $('#topUserName').innerText = state.user.name;
    $('#topUserRole').innerText = cap(state.user.role);

    // Apply Role-Based Display Constraints
    $$('.admin-only').forEach(el => el.classList.toggle('hidden', state.user.role !== 'admin'));
    $$('.permission-approve').forEach(el => el.classList.toggle('hidden', !['admin', 'approver'].includes(state.user.role)));
    $$('.permission-control').forEach(el => el.classList.toggle('hidden', !['admin', 'controller'].includes(state.user.role)));
  }
}

function navigate(view) {
  state.currentView = view;
  $$('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  const content = $('#content');
  if (!content) return;

  switch (view) {
    case 'dashboard': renderDashboard(); break;
    case 'journeys': renderJourneys(); break;
    case 'control': renderControlRoom(); break;
    case 'approvals': renderApprovals(); break;
    case 'vehicles': renderVehicles(); break;
    case 'drivers': renderDrivers(); break;
    case 'users': renderUsers(); break;
    case 'reports': renderReports(); break;
    case 'settings': renderSettings(); break;
    default: renderDashboard();
  }
}

async function preloadResources() {
  try {
    const [vehicles, drivers, riskQ, checkI] = await Promise.all([
      api('/api/vehicles'),
      api('/api/drivers'),
      api('/api/settings/risk-questions'),
      api('/api/settings/checklist-items')
    ]);
    state.vehicles = vehicles;
    state.drivers = drivers;
    state.riskQuestions = riskQ;
    state.checklistItems = checkI;
  } catch (e) {
    console.error('Failed preloading wizard dependencies', e);
  }
}

/* ==========================================================================
   VIEW RENDERERS
   ========================================================================== */

async function renderDashboard() {
  $('#pageTitle').innerText = 'Operational Dashboard';
  $('#pageSubtitle').innerText = 'Real-time fleet activity & journey metrics';
  
  const content = $('#content');
  content.innerHTML = '<div class="spinner">Loading metrics...</div>';

  try {
    const stats = await api('/api/reports/dashboard-summary');
    content.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.active_journeys || 0}</div>
          <div class="stat-label">Active Journeys</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.pending_approvals || 0}</div>
          <div class="stat-label">Pending Approvals</div>
        </div>
        <div class="stat-card">
          <div class="stat-value text-danger">${stats.overdue_journeys || 0}</div>
          <div class="stat-label">Overdue Journeys</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.total_vehicles || 0}</div>
          <div class="stat-label">Total Fleet Vehicles</div>
        </div>
      </div>
      
      <div class="panel style="margin-top:20px;">
        <h3>Recent Journeys</h3>
        <div id="recentJourneysTable">Loading recent activities...</div>
      </div>
    `;

    const recent = await api('/api/journeys?limit=5');
    renderJourneyTable($('#recentJourneysTable'), recent);
  } catch (e) {
    content.innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

async function renderJourneys() {
  $('#pageTitle').innerText = 'Journeys Registry';
  $('#pageSubtitle').innerText = 'Manage and track all submitted journey requests';
  
  const content = $('#content');
  content.innerHTML = `
    <div class="actions-bar">
      <button class="btn primary" onclick="openJourneyForm()">＋ Create Journey Request</button>
    </div>
    <div class="panel style="margin-top:15px;">
      <div id="journeysTableContainer">Loading journeys...</div>
    </div>
  `;

  try {
    const journeys = await api('/api/journeys');
    state.journeys = journeys;
    renderJourneyTable($('#journeysTableContainer'), journeys, true);
  } catch (e) {
    $('#journeysTableContainer').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

function renderJourneyTable(container, journeys, fullControls = false) {
  if (!journeys || journeys.length === 0) {
    container.innerHTML = '<p class="muted">No journeys found.</p>';
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Journey No</th>
          <th>Requester</th>
          <th>Route</th>
          <th>Departure</th>
          <th>Risk</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${journeys.map(j => `
          <tr>
            <td><strong>${esc(j.journey_no)}</strong></td>
            <td>${esc(j.requester?.name || '—')}</td>
            <td>${esc(j.start_location)} ➔ ${esc(j.end_location)}</td>
            <td>${fmtDate(j.departure_at, true)}</td>
            <td><span class="badge risk-${j.risk_level}">${esc(j.risk_level)}</span></td>
            <td><span class="badge status-${j.status}">${cap(j.status)}</span></td>
            <td>
              <button class="btn btn-sm" onclick="openJourneyDetail(${j.id})">Details</button>
              ${fullControls && ['draft', 'pending'].includes(j.status) ? `<button class="btn btn-sm" onclick="editJourney(${j.id})">Edit</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function renderControlRoom() {
  $('#pageTitle').innerText = 'Live Control Room';
  $('#pageSubtitle').innerText = 'Monitor in-progress journeys and log driver check-ins';
  
  const content = $('#content');
  content.innerHTML = '<div class="spinner">Loading active journeys...</div>';

  try {
    const active = await api('/api/journeys?status=in_progress');
    if (active.length === 0) {
      content.innerHTML = '<div class="panel"><p class="muted">No journeys are currently in progress.</p></div>';
      return;
    }

    content.innerHTML = `
      <div class="grid-cards">
        ${active.map(j => `
          <div class="panel card">
            <div class="card-header">
              <h4>${esc(j.journey_no)}</h4>
              <span class="badge status-${j.status}">${cap(j.status)}</span>
            </div>
            <p><strong>Route:</strong> ${esc(j.start_location)} ➔ ${esc(j.end_location)}</p>
            <p><strong>Driver:</strong> ${esc(j.driver?.name || 'Unassigned')}</p>
            <p><strong>Vehicle:</strong> ${esc(j.vehicle?.plate || 'Unassigned')}</p>
            <div class="card-actions" style="margin-top:15px;">
              <button class="btn primary btn-sm" onclick="promptCheckin(${j.id})">Log Check-in</button>
              <button class="btn success btn-sm" onclick="promptTransition(${j.id}, 'completed')">Complete Journey</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    content.innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

async function renderApprovals() {
  $('#pageTitle').innerText = 'Pending Approvals';
  $('#pageSubtitle').innerText = 'Review and process journey authorization requests';

  const content = $('#content');
  content.innerHTML = '<div class="spinner">Loading pending approvals...</div>';

  try {
    const pending = await api('/api/journeys?status=pending');
    if (pending.length === 0) {
      content.innerHTML = '<div class="panel"><p class="muted">No pending approvals at this time.</p></div>';
      return;
    }

    content.innerHTML = `
      <div class="panel">
        <table class="data-table">
          <thead>
            <tr>
              <th>Journey No</th>
              <th>Requester</th>
              <th>Division</th>
              <th>Departure</th>
              <th>Risk Level</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pending.map(j => `
              <tr>
                <td><strong>${esc(j.journey_no)}</strong></td>
                <td>${esc(j.requester?.name)}</td>
                <td>${esc(j.division)}</td>
                <td>${fmtDate(j.departure_at, true)}</td>
                <td><span class="badge risk-${j.risk_level}">${esc(j.risk_level)}</span></td>
                <td>
                  <button class="btn success btn-sm" onclick="promptDecision(${j.id}, 'approve')">Approve</button>
                  <button class="btn danger btn-sm" onclick="promptDecision(${j.id}, 'reject')">Reject</button>
                  <button class="btn btn-sm" onclick="openJourneyDetail(${j.id})">Review</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    content.innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

async function renderVehicles() {
  $('#pageTitle').innerText = 'Vehicles Registry';
  $('#pageSubtitle').innerText = 'Manage fleet vehicles and compliance expirations';

  const content = $('#content');
  content.innerHTML = `
    <div class="actions-bar">
      <button class="btn primary" onclick="openVehicleForm()">＋ Add Vehicle</button>
    </div>
    <div class="panel" style="margin-top:15px;">
      <div id="vehiclesContainer">Loading vehicles...</div>
    </div>
  `;

  try {
    const list = await api('/api/vehicles');
    state.vehicles = list;
    $('#vehiclesContainer').innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Plate</th>
            <th>Model</th>
            <th>Type</th>
            <th>License Exp</th>
            <th>Insurance Exp</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(v => `
            <tr>
              <td><strong>${esc(v.plate)}</strong></td>
              <td>${esc(v.model)}</td>
              <td>${esc(v.vehicle_type)}</td>
              <td>${fmtDate(v.license_expiry)}</td>
              <td>${fmtDate(v.insurance_expiry)}</td>
              <td><button class="btn btn-sm" onclick='openVehicleForm(${JSON.stringify(v)})'>Edit</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    $('#vehiclesContainer').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

async function renderDrivers() {
  $('#pageTitle').innerText = 'Drivers Registry';
  $('#pageSubtitle').innerText = 'Manage driver profiles, licenses, and rest hours';

  const content = $('#content');
  content.innerHTML = `
    <div class="actions-bar">
      <button class="btn primary" onclick="openDriverForm()">＋ Add Driver</button>
    </div>
    <div class="panel" style="margin-top:15px;">
      <div id="driversContainer">Loading drivers...</div>
    </div>
  `;

  try {
    const list = await api('/api/drivers');
    state.drivers = list;
    $('#driversContainer').innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>License Class</th>
            <th>License Exp</th>
            <th>Rest Hours</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(d => `
            <tr>
              <td><strong>${esc(d.name)}</strong></td>
              <td>${esc(d.phone)}</td>
              <td>${esc(d.license_class)}</td>
              <td>${fmtDate(d.license_expiry)}</td>
              <td>${d.rest_hours || 0} hrs</td>
              <td><button class="btn btn-sm" onclick='openDriverForm(${JSON.stringify(d)})'>Edit</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    $('#driversContainer').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

async function renderUsers() {
  $('#pageTitle').innerText = 'User Management';
  $('#pageSubtitle').innerText = 'Manage user access, roles, and security credentials';

  const content = $('#content');
  content.innerHTML = `
    <div class="actions-bar">
      <button class="btn primary" onclick="openUserForm()">＋ Add User</button>
    </div>
    <div class="panel" style="margin-top:15px;">
      <div id="usersContainer">Loading users...</div>
    </div>
  `;

  try {
    const list = await api('/api/users');
    state.users = list;
    $('#usersContainer').innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Division</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(u => `
            <tr>
              <td><strong>${esc(u.name)}</strong></td>
              <td>${esc(u.email)}</td>
              <td><span class="badge">${cap(u.role)}</span></td>
              <td>${esc(u.division || '—')}</td>
              <td>
                <button class="btn btn-sm" onclick='openUserForm(${JSON.stringify(u)})'>Edit</button>
                <button class="btn btn-sm danger" onclick="openResetPassword(${u.id})">Reset Pass</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    $('#usersContainer').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

async function renderReports() {
  $('#pageTitle').innerText = 'Reports & Audit Logs';
  $('#pageSubtitle').innerText = 'Export operational logs and system audit trails';
  
  const content = $('#content');
  content.innerHTML = `
    <div class="panel">
      <h3>System Audit Logs</h3>
      <p class="muted">All modifications, status transitions, and user actions are recorded chronologically.</p>
      <div id="auditLogsContainer">Loading audit logs...</div>
    </div>
  `;

  try {
    const logs = await api('/api/reports/audit-logs');
    $('#auditLogsContainer').innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td>${fmtDate(l.created_at, true)}</td>
              <td>${esc(l.user_name || 'System')}</td>
              <td><strong>${esc(l.action)}</strong></td>
              <td>${esc(l.entity_type)} #${l.entity_id || ''}</td>
              <td><small>${esc(l.details)}</small></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    $('#auditLogsContainer').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

function renderSettings() {
  $('#pageTitle').innerText = 'System Settings';
  $('#pageSubtitle').innerText = 'Global system configurations and rule setup';
  $('#content').innerHTML = `
    <div class="panel">
      <h3>Platform Settings</h3>
      <p>Configure risk matrix settings and journey checklist requirements from the backend configurations.</p>
    </div>
  `;
}

/* ==========================================================================
   JOURNEY WIZARD & MODAL ACTIONS
   ========================================================================== */

async function openJourneyForm(journey = null) {
  await preloadResources();
  const answerMap = Object.fromEntries((journey?.risk_answers || []).map(x => [x.question_key, x.answer]));
  const checklistMap = Object.fromEntries((journey?.checklist_answers || []).map(x => [x.item_key, x.confirmed]));
  
  const body = `<form id="journeyForm">
    <div class="wizard-tabs">
      ${['Division', 'Trip Details', 'Vehicle & Driver', 'Risk Assessment', 'Checklist'].map((x, i) => `<button type="button" class="wizard-tab ${i === 0 ? 'active' : ''}" data-step="${i}">${i + 1}. ${x}</button>`).join('')}
    </div>
    
    <div class="wizard-pane active" data-step="0">
      ${input('j_division', 'Division / Department', journey?.division || state.user?.division || '')}
      ${input('j_purpose', 'Purpose of Journey', journey?.purpose || '')}
    </div>

    <div class="wizard-pane hidden" data-step="1">
      <div class="grid-2">
        ${input('j_start', 'Start Location', journey?.start_location || '')}
        ${input('j_end', 'End Location', journey?.end_location || '')}
      </div>
      <div class="grid-2">
        ${input('j_departure', 'Departure Time', localInputDate(journey?.departure_at), 'datetime-local')}
        ${input('j_arrival', 'Estimated Arrival Time', localInputDate(journey?.estimated_arrival_at), 'datetime-local')}
      </div>
      ${input('j_passengers', 'Passenger Count / Names', journey?.passengers || '1', 'text', false)}
      ${input('j_cargo', 'Cargo Description', journey?.cargo_details || '', 'text', false)}
    </div>

    <div class="wizard-pane hidden" data-step="2">
      <label>Select Vehicle
        <select id="j_vehicle" class="field" required>
          <option value="">-- Choose Vehicle --</option>
          ${state.vehicles.map(v => `<option value="${v.id}" ${journey?.vehicle_id === v.id ? 'selected' : ''}>${esc(v.plate)} (${esc(v.model)})</option>`).join('')}
        </select>
      </label>
      <label style="margin-top:12px; display:block;">Select Driver
        <select id="j_driver" class="field" required>
          <option value="">-- Choose Driver --</option>
          ${state.drivers.map(d => `<option value="${d.id}" ${journey?.driver_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
      </label>
    </div>

    <div class="wizard-pane hidden" data-step="3">
      <h4>Risk Assessment Questions</h4>
      ${state.riskQuestions.map(q => `
        <div style="margin-bottom:12px">
          <p><strong>${esc(q.prompt)}</strong></p>
          <label><input type="radio" name="rq_${q.key}" value="yes" ${answerMap[q.key] === 'yes' ? 'checked' : ''}> Yes</label>
          <label style="margin-left:15px;"><input type="radio" name="rq_${q.key}" value="no" ${answerMap[q.key] === 'no' || !answerMap[q.key] ? 'checked' : ''}> No</label>
        </div>
      `).join('')}
    </div>

    <div class="wizard-pane hidden" data-step="4">
      <h4>Pre-Trip Checklist</h4>
      ${state.checklistItems.map(c => `
        <label style="display:block; margin-bottom:8px">
          <input type="checkbox" name="cl_${c.key}" ${checklistMap[c.key] ? 'checked' : ''}> ${esc(c.label)}
        </label>
      `).join('')}
    </div>
  </form>`;

  const footer = `
    <button class="btn" id="wizPrev" type="button" disabled>Previous</button>
    <button class="btn primary" id="wizNext" type="button">Next</button>
    <button class="btn success hidden" id="wizSubmit" type="button">${journey ? 'Update Request' : 'Submit Request'}</button>
  `;

  openModal({
    title: journey ? `Edit Journey: ${journey.journey_no}` : 'Create New Journey',
    body, footer, large: true
  });

  let currentStep = 0;
  const panes = $$('.wizard-pane');
  const tabs = $$('.wizard-tab');

  const updateWizard = (step) => {
    currentStep = step;
    panes.forEach((p, i) => p.classList.toggle('hidden', i !== step));
    tabs.forEach((t, i) => t.classList.toggle('active', i === step));
    $('#wizPrev').disabled = currentStep === 0;
    $('#wizNext').classList.toggle('hidden', currentStep === panes.length - 1);
    $('#wizSubmit').classList.toggle('hidden', currentStep !== panes.length - 1);
  };

  $('#wizPrev').onclick = () => updateWizard(Math.max(0, currentStep - 1));
  $('#wizNext').onclick = () => updateWizard(Math.min(panes.length - 1, currentStep + 1));
  tabs.forEach(t => t.onclick = () => updateWizard(+t.dataset.step));

  $('#wizSubmit').onclick = async () => {
    const riskAnswers = state.riskQuestions.map(q => ({
      question_key: q.key,
      answer: $(`input[name="rq_${q.key}"]:checked`)?.value || 'no'
    }));

    const checklistAnswers = state.checklistItems.map(c => ({
      item_key: c.key,
      confirmed: $(`input[name="cl_${c.key}"]`)?.checked || false
    }));

    const payload = {
      division: $('#j_division').value,
      purpose: $('#j_purpose').value,
      start_location: $('#j_start').value,
      end_location: $('#j_end').value,
      departure_at: $('#j_departure').value,
      estimated_arrival_at: $('#j_arrival').value,
      passengers: $('#j_passengers').value,
      cargo_details: $('#j_cargo').value,
      vehicle_id: +$('#j_vehicle').value,
      driver_id: +$('#j_driver').value,
      risk_answers: riskAnswers,
      checklist_answers: checklistAnswers
    };

    try {
      if (journey) await api(`/api/journeys/${journey.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/journeys', { method: 'POST', body: JSON.stringify(payload) });
      toast('Journey saved successfully');
      closeModal();
      navigate(state.currentView);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

async function editJourney(id) {
  try {
    const j = await api(`/api/journeys/${id}`);
    openJourneyForm(j);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function openJourneyDetail(id) {
  const j = await api(`/api/journeys/${id}`);
  const body = `
    <div class="grid-2">
      <div><strong>Status:</strong> <span class="badge status-${j.status}">${cap(j.status)}</span></div>
      <div><strong>Risk:</strong> <span class="badge risk-${j.risk_level}">${esc(j.risk_level)}</span></div>
      <div><strong>Requester:</strong> ${esc(j.requester?.name)}</div>
      <div><strong>Division:</strong> ${esc(j.division)}</div>
      <div><strong>Driver:</strong> ${esc(j.driver?.name || '—')}</div>
      <div><strong>Vehicle:</strong> ${esc(j.vehicle?.plate || '—')}</div>
      <div><strong>Route:</strong> ${esc(j.start_location)} ➔ ${esc(j.end_location)}</div>
      <div><strong>Departure:</strong> ${fmtDate(j.departure_at, true)}</div>
    </div>
    <hr style="margin:15px 0">
    <h4>Approvals Log</h4>
    <ul>${(j.approvals || []).map(a => `<li>${cap(a.required_role)}: <strong>${a.status}</strong> by ${esc(a.approver_name || '—')}</li>`).join('') || '<li>No approvals yet</li>'}</ul>
  `;
  openModal({ title: `Journey Details: ${j.journey_no}`, body, large: true });
}

function promptTransition(id, status) {
  openModal({
    title: `Change Status to ${cap(status)}`,
    body: `<p>Are you sure you want to transition this journey to <strong>${cap(status)}</strong>?</p>`,
    footer: `<button class="btn primary" id="confirmTrans">Confirm</button><button class="btn" data-close>Cancel</button>`
  });
  $('#confirmTrans').onclick = async () => {
    try {
      await api(`/api/journeys/${id}/transition`, { method: 'POST', body: JSON.stringify({ status }) });
      toast(`Journey updated to ${status}`);
      closeModal();
      navigate(state.currentView);
    } catch (e) { toast(e.message, 'error'); }
  };
}

function promptCheckin(id) {
  openModal({
    title: 'Log Driver Check-in',
    body: `${input('checkin_loc', 'Current Location')}${input('checkin_notes', 'Notes / Observations', '', 'text', false)}`,
    footer: `<button class="btn success" id="confirmCheckin">Log Check-in</button>`
  });
  $('#confirmCheckin').onclick = async () => {
    try {
      await api(`/api/journeys/${id}/checkin`, {
        method: 'POST',
        body: JSON.stringify({ location: $('#checkin_loc').value, notes: $('#checkin_notes').value })
      });
      toast('Check-in logged successfully');
      closeModal();
      navigate(state.currentView);
    } catch (e) { toast(e.message, 'error'); }
  };
}

function promptDecision(id, decision) {
  openModal({
    title: `${cap(decision)} Journey Request`,
    body: `${input('dec_comment', 'Comments / Reason', '', 'text', decision !== 'approve')}`,
    footer: `<button class="btn primary" id="confirmDec">Submit ${cap(decision)}</button>`
  });
  $('#confirmDec').onclick = async () => {
    try {
      await api(`/api/journeys/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, comment: $('#dec_comment').value })
      });
      toast(`Journey ${decision}d successfully`);
      closeModal();
      navigate(state.currentView);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* Vehicle & Driver Form Handlers */
function openVehicleForm(v = null) {
  const body = `<form id="vForm">
    ${input('v_plate', 'Plate Number', v?.plate || '')}
    ${input('v_model', 'Model', v?.model || '')}
    ${input('v_type', 'Vehicle Type', v?.vehicle_type || '')}
    ${input('v_contractor', 'Contractor', v?.contractor || '', 'text', false)}
    ${input('v_lic', 'License Expiry', dateValue(v?.license_expiry), 'date')}
    ${input('v_ins', 'Insurance Expiry', dateValue(v?.insurance_expiry), 'date')}
    ${input('v_insp', 'Inspection Expiry', dateValue(v?.inspection_expiry), 'date')}
  </form>`;
  openModal({
    title: v ? 'Edit Vehicle' : 'Add Vehicle',
    body,
    footer: `<button class="btn primary" id="saveVehicle">Save</button>`
  });
  $('#saveVehicle').onclick = async () => {
    const payload = {
      plate: $('#v_plate').value, model: $('#v_model').value, vehicle_type: $('#v_type').value,
      contractor: $('#v_contractor').value, license_expiry: $('#v_lic').value,
      insurance_expiry: $('#v_ins').value, inspection_expiry: $('#v_insp').value
    };
    try {
      if (v) await api(`/api/vehicles/${v.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/vehicles', { method: 'POST', body: JSON.stringify(payload) });
      toast('Vehicle saved'); closeModal(); renderVehicles();
    } catch (e) { toast(e.message, 'error'); }
  };
}

function openDriverForm(d = null) {
  const body = `<form id="dForm">
    ${input('d_name', 'Driver Name', d?.name || '')}
    ${input('d_phone', 'Phone', d?.phone || '')}
    ${input('d_lic_class', 'License Class', d?.license_class || '')}
    ${input('d_lic_exp', 'License Expiry', dateValue(d?.license_expiry), 'date')}
    ${input('d_ddc_exp', 'DDC Expiry', dateValue(d?.ddc_expiry), 'date')}
    ${input('d_med_exp', 'Medical Expiry', dateValue(d?.medical_expiry), 'date')}
    ${input('d_def_exp', 'Defensive Driving Expiry', dateValue(d?.defensive_expiry), 'date')}
    ${input('d_rest', 'Rest Hours', d?.rest_hours || 8, 'number')}
  </form>`;
  openModal({
    title: d ? 'Edit Driver' : 'Add Driver',
    body,
    footer: `<button class="btn primary" id="saveDriver">Save</button>`
  });
  $('#saveDriver').onclick = async () => {
    const payload = {
      name: $('#d_name').value, phone: $('#d_phone').value, license_class: $('#d_lic_class').value,
      license_expiry: $('#d_lic_exp').value, ddc_expiry: $('#d_ddc_exp').value,
      medical_expiry: $('#d_med_exp').value, defensive_expiry: $('#d_def_exp').value, rest_hours: +$('#d_rest').value
    };
    try {
      if (d) await api(`/api/drivers/${d.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/drivers', { method: 'POST', body: JSON.stringify(payload) });
      toast('Driver saved'); closeModal(); renderDrivers();
    } catch (e) { toast(e.message, 'error'); }
  };
}

function openUserForm(u = null) {
  const body = `<form id="uForm">
    ${input('u_name', 'Full Name', u?.name || '')}
    ${input('u_email', 'Email Address', u?.email || '', 'email')}
    ${input('u_title', 'Job Title', u?.title || '', 'text', false)}
    ${input('u_division', 'Division', u?.division || '')}
    <label style="display:block; margin-top:8px;">Role
      <select id="u_role" class="field" style="width:100%; margin-top:4px;">
        <option value="requester" ${u?.role === 'requester' ? 'selected' : ''}>Requester</option>
        <option value="approver" ${u?.role === 'approver' ? 'selected' : ''}>Approver</option>
        <option value="controller" ${u?.role === 'controller' ? 'selected' : ''}>Controller</option>
        <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin</option>
      </select>
    </label>
  </form>`;
  openModal({
    title: u ? 'Edit User' : 'Add User',
    body,
    footer: `<button class="btn primary" id="saveUser">Save User</button>`
  });
  $('#saveUser').onclick = async () => {
    const payload = {
      name: $('#u_name').value, email: $('#u_email').value, title: $('#u_title').value,
      division: $('#u_division').value, role: $('#u_role').value
    };
    try {
      if (u) await api(`/api/users/${u.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
      toast('User saved'); closeModal(); renderUsers();
    } catch (e) { toast(e.message, 'error'); }
  };
}

function openResetPassword(id) {
  openModal({
    title: 'Reset User Password',
    body: input('new_pass', 'New Password', '', 'password'),
    footer: `<button class="btn primary" id="confirmReset">Set New Password</button>`
  });
  $('#confirmReset').onclick = async () => {
    try {
      await api(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: $('#new_pass').value }) });
      toast('Password reset successfully'); closeModal();
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ==========================================================================
   EVENT LISTENERS & BOOTSTRAP
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Login Form Submission
  const loginForm = $('#loginForm');
  if (loginForm) {
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const errBox = $('#loginError');
      errBox.classList.add('hidden');
      try {
        const user = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: $('#loginEmail').value,
            password: $('#loginPassword').value,
            otp: $('#loginOtp')?.value || ''
          })
        });
        state.user = user;
        showAppShell();
        navigate('dashboard');
      } catch (err) {
        errBox.innerText = err.message;
        errBox.classList.remove('hidden');
      }
    };
  }

  // App Navigation Clicks
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-view]');
    if (navBtn) {
      const view = navBtn.dataset.view;
      if (view === 'new') {
        openJourneyForm();
      } else {
        navigate(view);
      }
      return;
    }

    if (e.target.closest('[data-close]') || e.target.classList.contains('modal-overlay')) {
      closeModal();
    }
  });

  // App Initialization
  if ($('#loginScreen') && $('#appShell')) {
    initialize();
  }
});