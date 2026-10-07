function suffix() {
  const time = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${time}-${rand}`;
}

function testDni() {
  // Rango reservado a la suite: 90.000.000-99.999.999.
  // Combina reloj + aleatorio para evitar colisiones entre altas consecutivas.
  const clock = Date.now() % 10000000;
  const random = Math.floor(Math.random() * 10000000);
  return String(90000000 + ((clock + random) % 10000000));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { suffix, testDni, today };
