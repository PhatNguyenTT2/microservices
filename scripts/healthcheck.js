const http = require('http');

const SERVICES = [
  'auth',
  'catalog',
  'order',
  'settings',
  'supplier',
  'inventory',
  'payment',
  'chatbot'
];

const checkService = (name) => {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get(`http://localhost:8080/ready/${name}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      
      res.on('end', () => {
        const time = Date.now() - start;
        try {
          const json = JSON.parse(data);
          resolve({
            Service: name.toUpperCase(),
            Status: res.statusCode === 200 ? 'UP' : 'DOWN',
            Database: json.dependencies?.postgres?.status === 'ok' ? 'OK' : 'ERROR',
            RabbitMQ: '-', // Currently not checked by /ready
            Time_ms: time
          });
        } catch (e) {
          resolve({
            Service: name.toUpperCase(),
            Status: res.statusCode === 200 ? 'UP' : 'DOWN',
            Database: '?',
            RabbitMQ: '?',
            Time_ms: time
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        Service: name.toUpperCase(),
        Status: 'DOWN',
        Database: '-',
        RabbitMQ: '-',
        Time_ms: Date.now() - start
      });
    });

    req.setTimeout(3000, () => {
      req.destroy();
      resolve({
        Service: name.toUpperCase(),
        Status: 'TIMEOUT',
        Database: '-',
        RabbitMQ: '-',
        Time_ms: '> 3000'
      });
    });
  });
};

async function run() {
  console.log('Fetching overall health status of POSMART microservices...\n');
  const results = await Promise.all(SERVICES.map(checkService));
  results.forEach(r => {
    console.log(`${r.Service.padEnd(10)} | HTTP: ${r.Status.padEnd(8)} | DB: ${r.Database.padEnd(8)} | MQ: ${r.RabbitMQ.padEnd(4)} | Time: ${r.Time_ms}ms`);
  });
}

run();
