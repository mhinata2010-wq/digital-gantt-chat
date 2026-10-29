const menuButton = document.getElementById('menuButton');
const sidebar = document.getElementById('sidebar');
menuButton?.addEventListener('click', () => sidebar?.classList.toggle('open'));

document.querySelectorAll('.segmented button').forEach((button) => {
  button.addEventListener('click', () => {
    button.parentElement.querySelectorAll('button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

document.querySelectorAll('.attention-item').forEach((item) => {
  item.addEventListener('click', () => {
    item.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
      { duration: 180 }
    );
  });
});

const canvas = document.getElementById('progressChart');
if (canvas && window.Chart) {
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(96, 120, 229, .22)');
  gradient.addColorStop(1, 'rgba(96, 120, 229, 0)');

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Oct 23', 'Oct 24', 'Oct 25', 'Oct 26', 'Oct 27', 'Oct 28', 'Oct 29'],
      datasets: [
        { label: 'Plan', data: [18, 31, 45, 59, 72, 86, 100], borderColor: '#b7bfd1', borderDash: [5, 5], borderWidth: 2, pointRadius: 0, tension: .32 },
        { label: 'Actual', data: [17, 29, 41, 52, 61, 68, 72], borderColor: '#6078e5', backgroundColor: gradient, fill: true, borderWidth: 2.4, pointBackgroundColor: '#6078e5', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: .34 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#313746', padding: 10, cornerRadius: 6 } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#a0a7b5', font: { size: 9, family: 'Inter' } } },
        y: { beginAtZero: true, max: 100, border: { display: false }, grid: { color: '#eef0f4' }, ticks: { stepSize: 25, color: '#a0a7b5', font: { size: 9, family: 'Inter' }, callback: (value) => `${value}%` } }
      }
    }
  });
}
