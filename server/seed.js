if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

const { seed } = await import('./db.js');
seed();
console.log('Seed complete');
