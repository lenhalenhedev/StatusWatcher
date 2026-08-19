import tls from 'node:tls';

const socket = tls.connect({
  host: 'example.com',
  port: 443,
  servername: 'example.com',
  rejectUnauthorized: false,
  timeout: 5_000,
  lookup: (_hostname, _options, callback) => callback(null, [{ address: '93.184.216.34', family: 4 }]),
});

socket.once('secureConnect', () => {
  console.log(JSON.stringify({ event: 'secureConnect', protocol: socket.getProtocol() }));
  socket.destroy();
});
socket.once('timeout', () => {
  console.error(JSON.stringify({ event: 'timeout' }));
  socket.destroy();
});
socket.once('error', (error) => {
  console.error(JSON.stringify({ event: 'error', code: error.code, name: error.name, message: error.message }));
});
socket.once('close', () => process.exitCode = 0);
