const cache = require('../cache/redis');
const { getPeriodDates, calculateChange, formatDateKey } = require('../utils/period');
const logger = require('../../../../shared/common/logger');

const CACHE_TTL = {
  DASHBOARD: 300,  // 5 minutes
  REPORT: 900      // 15 minutes
};

class StatisticsService {
  constructor({ orderClient, catalogClient, authClient }) {
    this.orderClient = orderClient;
    this.catalogClient = catalogClient;
    this.authClient = authClient;
  }

  /**
   * Dashboard Statistics
   * Aggregates: orders + customers + categories
   */
  async getDashboard(token, period = 'month') {
    const cacheKey = cache.buildKey('dashboard', 'all', { period });
    const cached = await cache.get(cacheKey);
    if (cached) {
      logger.info({ cacheKey }, 'Dashboard served from cache');
      return cached;
    }

    const { startDate, endDate, prevStartDate, prevEndDate } = getPeriodDates(period);

    // Fetch data from services in parallel
    const [orders, customers] = await Promise.all([
      this.orderClient.getOrders(token),
      this.authClient.getCustomers(token)
    ]);

    // Filter orders by period and status
    const currentOrders = orders.filter(o =>
      new Date(o.order_date || o.created_at) >= startDate &&
      new Date(o.order_date || o.created_at) <= endDate &&
      o.status === 'delivered' && o.payment_status === 'paid'
    );

    const previousOrders = orders.filter(o =>
      new Date(o.order_date || o.created_at) >= prevStartDate &&
      new Date(o.order_date || o.created_at) <= prevEndDate &&
      o.status === 'delivered' && o.payment_status === 'paid'
    );

    // Summary metrics
    const currentTotalOrders = currentOrders.length;
    const previousTotalOrders = previousOrders.length;

    const currentTotalRevenue = currentOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || o.total || 0), 0);
    const previousTotalRevenue = previousOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || o.total || 0), 0);

    // Sales quantity (use item_count or estimate from orders)
    const currentTotalSales = currentOrders.reduce((sum, o) => sum + (o.item_count || 1), 0);
    const previousTotalSales = previousOrders.reduce((sum, o) => sum + (o.item_count || 1), 0);

    // New customers in period
    const currentNewCustomers = customers.filter(c =>
      new Date(c.created_at) >= startDate && new Date(c.created_at) <= endDate
    ).length;
    const previousNewCustomers = customers.filter(c =>
      new Date(c.created_at) >= prevStartDate && new Date(c.created_at) <= prevEndDate
    ).length;

    // Changes
    const changes = {
      totalOrders: calculateChange(currentTotalOrders, previousTotalOrders),
      totalSales: calculateChange(currentTotalSales, previousTotalSales),
      newCustomers: calculateChange(currentNewCustomers, previousNewCustomers),
      totalRevenue: calculateChange(currentTotalRevenue, previousTotalRevenue)
    };

    // Order trend chart data
    const orderTrend = this._buildOrderTrend(currentOrders, previousOrders, period, startDate, endDate, prevStartDate, prevEndDate);

    // Top categories (from order items if available, otherwise placeholder)
    const topCategories = this._buildTopCategories(currentOrders);

    // Recent transactions
    const transactions = currentOrders
      .sort((a, b) => new Date(b.order_date || b.created_at) - new Date(a.order_date || a.created_at))
      .slice(0, 10)
      .map(order => ({
        id: order.order_number || `ORD-${order.id}`,
        customer: order.customer_name || 'Walk-in',
        phone: order.customer_phone || 'N/A',
        amount: parseFloat(order.total_amount || order.total || 0),
        date: new Date(order.order_date || order.created_at).toLocaleDateString('vi-VN'),
        status: order.status
      }));

    const result = {
      totalOrders: currentTotalOrders,
      totalSales: currentTotalSales,
      newCustomers: currentNewCustomers,
      totalRevenue: currentTotalRevenue,
      changes,
      orderTrend,
      topCategories,
      transactions
    };

    await cache.set(cacheKey, result, CACHE_TTL.DASHBOARD);
    return result;
  }

  /**
   * Sales Report
   */
  async getSalesReport(token, params) {
    const { startDate, endDate } = params;
    const cacheKey = cache.buildKey('sales', 'all', params);
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const orders = await this.orderClient.getOrders(token);

    const filteredOrders = orders.filter(o =>
      new Date(o.order_date || o.created_at) >= new Date(startDate) &&
      new Date(o.order_date || o.created_at) <= new Date(endDate) &&
      o.status === 'delivered' && o.payment_status === 'paid'
    );

    const totalRevenue = filteredOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || o.total || 0), 0);
    const totalQuantity = filteredOrders.reduce((sum, o) => sum + (o.item_count || 1), 0);

    const result = {
      summary: {
        totalRevenue,
        totalOrders: filteredOrders.length,
        totalQuantity,
        totalProducts: 0,
        averageOrderValue: filteredOrders.length > 0 ? totalRevenue / filteredOrders.length : 0
      },
      products: []
    };

    await cache.set(cacheKey, result, CACHE_TTL.REPORT);
    return result;
  }

  /**
   * Purchase Report
   */
  async getPurchaseReport(token, params) {
    const cacheKey = cache.buildKey('purchases', 'all', params);
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const result = {
      summary: {
        totalCost: 0,
        totalOrders: 0,
        totalQuantity: 0,
        totalProducts: 0,
        averageOrderValue: 0
      },
      products: []
    };

    await cache.set(cacheKey, result, CACHE_TTL.REPORT);
    return result;
  }

  /**
   * Profit Report
   */
  async getProfitReport(token, params) {
    const cacheKey = cache.buildKey('profit', 'all', params);
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const result = {
      summary: { totalRevenue: 0, totalCost: 0, grossProfit: 0, profitMargin: 0 },
      monthlyData: [],
      products: []
    };

    await cache.set(cacheKey, result, CACHE_TTL.REPORT);
    return result;
  }

  /**
   * Inventory Report
   */
  async getInventoryReport(token, params) {
    const cacheKey = cache.buildKey('inventory', 'all', params);
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const result = {
      summary: { totalProducts: 0, totalValue: 0, lowStockCount: 0, expiringSoonCount: 0 },
      products: []
    };

    await cache.set(cacheKey, result, CACHE_TTL.REPORT);
    return result;
  }

  /**
   * Employee Sales Report
   */
  async getEmployeeSalesReport(token, params) {
    const cacheKey = cache.buildKey('employee-sales', 'all', params);
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const result = {
      summary: { totalEmployees: 0, totalRevenue: 0, totalOrders: 0 },
      employees: []
    };

    await cache.set(cacheKey, result, CACHE_TTL.REPORT);
    return result;
  }

  /**
   * Customer Sales Report
   */
  async getCustomerSalesReport(token, params) {
    const cacheKey = cache.buildKey('customer-sales', 'all', params);
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const result = {
      summary: { totalCustomers: 0, totalRevenue: 0, totalOrders: 0 },
      customers: []
    };

    await cache.set(cacheKey, result, CACHE_TTL.REPORT);
    return result;
  }

  // ================== Private Helpers ==================

  _buildOrderTrend(currentOrders, previousOrders, period, startDate, endDate, prevStartDate, prevEndDate) {
    const currentByDate = {};
    currentOrders.forEach(order => {
      const dateKey = formatDateKey(new Date(order.order_date || order.created_at));
      currentByDate[dateKey] = (currentByDate[dateKey] || 0) + parseFloat(order.total_amount || order.total || 0);
    });

    const previousByDate = {};
    previousOrders.forEach(order => {
      const dateKey = formatDateKey(new Date(order.order_date || order.created_at));
      previousByDate[dateKey] = (previousByDate[dateKey] || 0) + parseFloat(order.total_amount || order.total || 0);
    });

    const trend = { labels: [], current: [], previous: [] };

    if (period === 'week') {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let d = new Date(startDate);
      while (d <= endDate) {
        const dateKey = formatDateKey(d);
        trend.labels.push(dayNames[d.getDay()]);
        trend.current.push(currentByDate[dateKey] || 0);
        d.setDate(d.getDate() + 1);
      }
      let pd = new Date(prevStartDate);
      while (pd <= prevEndDate) {
        trend.previous.push(previousByDate[formatDateKey(pd)] || 0);
        pd.setDate(pd.getDate() + 1);
      }

    } else if (period === 'month') {
      const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
      const interval = Math.max(Math.floor(totalDays / 8), 1);
      let d = new Date(startDate);
      let dayCount = 0;
      while (d <= endDate) {
        const dateKey = formatDateKey(d);
        if (dayCount % interval === 0) {
          const label = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
          trend.labels.push(label);
          trend.current.push(currentByDate[dateKey] || 0);
        }
        d.setDate(d.getDate() + 1);
        dayCount++;
      }
      let pd = new Date(prevStartDate);
      let prevDayCount = 0;
      while (pd <= prevEndDate) {
        if (prevDayCount % interval === 0) {
          trend.previous.push(previousByDate[formatDateKey(pd)] || 0);
        }
        pd.setDate(pd.getDate() + 1);
        prevDayCount++;
      }

    } else if (period === 'year') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const currentByMonth = Array(12).fill(0);
      const previousByMonth = Array(12).fill(0);

      currentOrders.forEach(o => {
        const month = new Date(o.order_date || o.created_at).getMonth();
        currentByMonth[month] += parseFloat(o.total_amount || o.total || 0);
      });
      previousOrders.forEach(o => {
        const month = new Date(o.order_date || o.created_at).getMonth();
        previousByMonth[month] += parseFloat(o.total_amount || o.total || 0);
      });

      trend.labels = monthNames;
      trend.current = currentByMonth;
      trend.previous = previousByMonth;
    }

    return trend;
  }

  _buildTopCategories(orders) {
    // Group by category from order data (if available)
    const categoryMap = {};
    orders.forEach(order => {
      const category = order.category_name || 'General';
      categoryMap[category] = (categoryMap[category] || 0) + 1;
    });

    const categoryColors = ['#e6816f', '#3b82f6', '#fbbf24', '#a855f7', '#10b981'];
    const sorted = Object.entries(categoryMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    const total = sorted.reduce((sum, [, count]) => sum + count, 0);

    return sorted.map(([name, count], index) => ({
      name,
      value: total > 0 ? Math.round((count / total) * 100) : 0,
      color: categoryColors[index] || '#6b7280'
    }));
  }
}

module.exports = StatisticsService;
