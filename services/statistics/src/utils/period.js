/**
 * Period date calculation utilities
 * Shared helpers for dashboard and report endpoints
 */

function getPeriodDates(period) {
  const now = new Date();
  let startDate, endDate, prevStartDate, prevEndDate;

  if (period === 'week') {
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    startDate = monday;
    endDate = sunday;
    prevStartDate = new Date(monday);
    prevStartDate.setDate(monday.getDate() - 7);
    prevEndDate = new Date(sunday);
    prevEndDate.setDate(sunday.getDate() - 7);

  } else if (period === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  } else if (period === 'year') {
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    prevStartDate = new Date(now.getFullYear() - 1, 0, 1);
    prevEndDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
  }

  return { startDate, endDate, prevStartDate, prevEndDate };
}

function calculateChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return parseFloat(((current - previous) / previous * 100).toFixed(1));
}

function formatDateKey(date) {
  return date.toISOString().split('T')[0];
}

module.exports = { getPeriodDates, calculateChange, formatDateKey };
