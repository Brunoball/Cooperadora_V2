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

function argentinaDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Cordoba",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  const utc = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + Number(offsetDays || 0)));
  return utc.toISOString().slice(0, 10);
}

function today() {
  return argentinaDate(0);
}

function tomorrow() {
  return argentinaDate(1);
}

function currentYear() {
  return Number(today().slice(0, 4));
}

function currentMonth() {
  return Number(today().slice(5, 7));
}

module.exports = { suffix, testDni, today, tomorrow, currentYear, currentMonth, argentinaDate };
