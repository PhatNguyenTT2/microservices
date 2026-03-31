function success(res, data = null, statusCode = 200) {
  const body = { success: true }; if (data !== null) body.data = data;
  return res.status(statusCode).json(body);
}
function created(res, data = null) { return success(res, data, 201); }
function paginated(res, { items, total, page, limit }) {
  return res.status(200).json({
    success: true, data: items,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) }
  });
}
module.exports = { success, created, paginated };
