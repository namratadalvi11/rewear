const { get } = require('../db');
const { today } = require('./core');

function isIsoDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function rentalDateError(item, renterId, startDate, endDate) {
  if (!item || item.listing_type !== 'rent') return 'This item is not available for rent right now.';
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return 'Please choose valid start and end dates.';
  }
  if (startDate < today()) return 'The start date cannot be in the past.';
  if (endDate < startDate) return 'The return date must be on or after the start date.';
  if ((item.available_from && startDate < item.available_from)
      || (item.available_to && endDate > item.available_to)) {
    return 'Those dates fall outside the period the owner has listed.';
  }
  const clash = get(`SELECT id FROM rentals WHERE item_id = ?
    AND status IN ('accepted','active','overdue') AND start_date <= ? AND end_date >= ?`,
  item.id, endDate, startDate);
  if (clash) return 'Those dates are already booked. Please pick another range.';
  if (item.owner_id === renterId) return 'You cannot rent your own listing.';
  if (item.status !== 'active') return 'This item is not available for rent right now.';
  return null;
}

module.exports = { isIsoDate, rentalDateError };
