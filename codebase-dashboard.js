const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const sidebar = $('#sidebar');
const overlay = $('#pageOverlay');
const sideOverlay = $('#sideOverlay');
const profileMenu = $('#profileMenu');
const notificationsMenu = $('#notificationsMenu');
const themePanel = $('#themePanel');
const genericModal = $('#genericModal');
const searchModal = $('#searchModal');
const currentSection = $('#currentSection');
const pageTitle = $('#pageTitle');
const pageSubtitle = $('#pageSubtitle');
const toastRegion = $('#toastRegion');

function isMobile() { return window.matchMedia('(max-width: 820px)').matches; }

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  toastRegion.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function closeFloating() {
  profileMenu.classList.remove('open');
  notificationsMenu.classList.remove('open');
}

function updateOverlay() {
  const shouldShow = (isMobile() && sidebar.classList.contains('open')) || sideOverlay.classList.contains('open');
  overlay.classList.toggle('show', shouldShow);
}

function openView(name) {
  currentSection.textContent = name;
  pageTitle.textContent = name;
  pageSubtitle.textContent = `${name} view is active in this interactive prototype.`;
  closeFloating();
  if (isMobile()) sidebar.classList.remove('open');
  updateOverlay();
  toast(`${name} opened`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openGeneric(title, message, confirmText = 'Continue') {
  $('#modalTitle').textContent = title;
  $('#modalMessage').textContent = message;
  $('#modalConfirm').textContent = confirmText;
  genericModal.classList.add('open');
  genericModal.setAttribute('aria-hidden', 'false');
}

function closeModal(modal) {
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden', 'true');
}

$('#menuButton').addEventListener('click', () => {
  closeFloating();
  if (isMobile()) sidebar.classList.toggle('open');
  else document.body.classList.toggle('sidebar-hidden');
  updateOverlay();
});

$('#sidebarClose').addEventListener('click', () => {
  sidebar.classList.remove('open');
  updateOverlay();
});

overlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  sideOverlay.classList.remove('open');
  updateOverlay();
});

$$('[data-nav-group]').forEach(button => {
  button.addEventListener('click', () => button.closest('.nav-group').classList.toggle('open'));
});

$$('[data-sub-group]').forEach(button => {
  button.addEventListener('click', () => button.nextElementSibling?.classList.toggle('open'));
});

$$('[data-view]').forEach(button => button.addEventListener('click', () => openView(button.dataset.view)));

$('#profileButton').addEventListener('click', e => {
  e.stopPropagation();
  notificationsMenu.classList.remove('open');
  profileMenu.classList.toggle('open');
});

$('#notificationsButton').addEventListener('click', e => {
  e.stopPropagation();
  profileMenu.classList.remove('open');
  notificationsMenu.classList.toggle('open');
});

$('#themeButton').addEventListener('click', () => themePanel.classList.toggle('open'));
$('#overlayButton').addEventListener('click', () => {
  sideOverlay.classList.add('open');
  updateOverlay();
});

$$('[data-close]').forEach(button => {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.close);
    if (target?.classList.contains('modal')) closeModal(target);
    else target?.classList.remove('open');
    updateOverlay();
  });
});

$('#searchButton').addEventListener('click', () => {
  searchModal.classList.add('open');
  searchModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#globalSearch').focus(), 0);
});

const searchable = [
  'Dashboard','Dashboard 2','Dashboard 3','Dashboard 4','Classic','Clean','Social','Corporate','Minimal','Medical',
  'Hosting Dashboard','Hosting Emails','Hosting Account','Hosting Support','Real Estate Dashboard','Listing','Add New Listing',
  'e-Commerce Dashboard','Orders','Products','Customer','Block Styles','Block Options','Block Forms','Block API','Tiles','Users',
  'Statistics','Projects','Buttons','Dropdowns','Tabs','Modals','Animations','Table Styles','Responsive Tables','DataTables',
  'Form Elements','Form Layouts','Form Plugins','Validation','Default Layout','Flipped Layout','Mini Sidebar','Full Width',
  'Charts','Notifications','Calendar','Sliders','Blank','Search','Profile','Inbox','Invoice','FAQ','Project List','Todo','Sign In',
  'Sign Up','Lock Screen','Two Factor','400','401','403','404','500','503','Sales','Earnings','Messages','Live Stats','Settings'
];

function renderSearch(query = '') {
  const normalized = query.trim().toLowerCase();
  const matches = searchable.filter(item => !normalized || item.toLowerCase().includes(normalized)).slice(0, 12);
  $('#searchResults').innerHTML = matches.length
    ? matches.map(item => `<button type="button" data-search-result="${item.replaceAll('"','&quot;')}">${item}</button>`).join('')
    : '<p>No results found.</p>';
  $$('[data-search-result]').forEach(btn => btn.addEventListener('click', () => {
    closeModal(searchModal);
    openView(btn.dataset.searchResult);
  }));
}
renderSearch('');

$('#globalSearch').addEventListener('input', e => renderSearch(e.target.value));
$('#searchForm').addEventListener('submit', e => {
  e.preventDefault();
  renderSearch($('#globalSearch').value);
});

$$('[data-accent]').forEach(button => {
  button.addEventListener('click', () => {
    const color = button.dataset.accent;
    document.documentElement.style.setProperty('--accent', color);
    const rgb = color.match(/[a-f\d]{2}/gi).map(hex => parseInt(hex, 16)).join(',');
    document.documentElement.style.setProperty('--accent-rgb', rgb);
    $$('.swatch').forEach(swatch => swatch.classList.remove('active'));
    button.classList.add('active');
    toast('Color theme updated');
  });
});

$$('[data-theme-choice]').forEach(button => {
  button.addEventListener('click', () => {
    const choice = button.dataset.themeChoice;
    const dark = choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    toast(`${choice[0].toUpperCase() + choice.slice(1)} mode selected`);
  });
});

function handleAction(action) {
  const handlers = {
    dashboard: () => openView('Dashboard'),
    'open-overlay': () => { sideOverlay.classList.add('open'); updateOverlay(); },
    settings: () => { themePanel.classList.add('open'); closeFloating(); },
    signout: () => openGeneric('Sign Out', 'This prototype will simulate signing out without ending a real session.', 'Sign Out'),
    'quick-add': () => openGeneric('Create New Item', 'Create a new dashboard item or project from this quick action.', 'Create'),
    'block-menu': () => toast('Block options opened'),
    refresh: () => { toast('Dashboard data refreshed'); pulseCharts(); },
    metric: () => toast('Metric detail opened'),
    'manage-list': () => openView('Subscriber List'),
    followers: () => openView('Followers'),
    upgrade: () => openGeneric('Upgrade to VIP', 'Upgrade flow opened. No real purchase will be made.', 'Upgrade'),
    'new-project': () => openGeneric('New Project', 'Create a new project in this prototype.', 'Create Project'),
    search: () => $('#searchButton').click(),
    about: () => openGeneric('About this UI', 'This page independently recreates the dashboard structure and interactions of the referenced Codebase demo without copying its commercial source code.', 'Close'),
    notice: () => toast('Notification opened'),
    friend: () => toast('Friend profile opened'),
    'update-profile': () => {
      const value = $('#profileName').value.trim() || 'John Smith';
      $$('.sidebar-user-copy strong').forEach(n => n.textContent = value.replace('John ', 'J. '));
      toast('Profile updated');
    }
  };
  handlers[action]?.();
}

$$('[data-action]').forEach(button => button.addEventListener('click', () => handleAction(button.dataset.action)));

$$('.setting-row input').forEach(input => input.addEventListener('change', () => toast(`${input.closest('.setting-row').querySelector('strong').textContent}: ${input.checked ? 'On' : 'Off'}`)));

document.addEventListener('click', e => {
  if (!e.target.closest('#profileButton') && !e.target.closest('#profileMenu')) profileMenu.classList.remove('open');
  if (!e.target.closest('#notificationsButton') && !e.target.closest('#notificationsMenu')) notificationsMenu.classList.remove('open');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeFloating();
    themePanel.classList.remove('open');
    sideOverlay.classList.remove('open');
    sidebar.classList.remove('open');
    closeModal(genericModal);
    closeModal(searchModal);
    updateOverlay();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#searchButton').click();
  }
});

$('#modalConfirm').addEventListener('click', () => {
  closeModal(genericModal);
  toast('Action completed');
});

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { intersect: false, mode: 'index' },
  plugins: { legend: { display: false }, tooltip: { backgroundColor: '#202832', padding: 10, cornerRadius: 2 } },
  scales: {
    x: { grid: { display: false }, border: { display: false }, ticks: { color: '#8c99aa', font: { size: 9 } } },
    y: { beginAtZero: true, border: { display: false }, grid: { color: 'rgba(128,140,153,.14)' }, ticks: { color: '#8c99aa', font: { size: 9 } } }
  }
};

function chartColors() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0665d0';
  return { accent };
}

let mainChart;
let earningsChart;

if (window.Chart) {
  const { accent } = chartColors();
  mainChart = new Chart($('#mainChart'), {
    type: 'line',
    data: { labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], datasets: [{ data: [72,98,84,128,116,148,160], borderColor: accent, backgroundColor: 'rgba(6,101,208,.08)', fill: true, tension: .35, borderWidth: 2, pointRadius: 3 }] },
    options: baseOptions
  });
  earningsChart = new Chart($('#earningsChart'), {
    type: 'bar',
    data: { labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], datasets: [{ data: [140,220,185,270,240,310,160], backgroundColor: ['#3f9d6e','#3f9d6e','#3f9d6e','#3f9d6e','#3f9d6e','#3f9d6e','#3f9d6e'], borderRadius: 2 }] },
    options: baseOptions
  });
}

function pulseCharts() {
  [$('#mainChart'), $('#earningsChart')].forEach(canvas => canvas?.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 320 }));
}

$$('[data-chart]').forEach(button => button.addEventListener('click', () => {
  $$('[data-chart]').forEach(b => b.classList.remove('active'));
  button.classList.add('active');
  if (!mainChart) return;
  if (button.dataset.chart === 'earnings') {
    mainChart.data.datasets[0].data = [420,560,510,760,680,820,910];
    mainChart.data.datasets[0].label = 'Earnings';
  } else {
    mainChart.data.datasets[0].data = [72,98,84,128,116,148,160];
    mainChart.data.datasets[0].label = 'Sales';
  }
  mainChart.update();
  toast(`${button.textContent.trim()} chart selected`);
}));

window.addEventListener('resize', updateOverlay);
