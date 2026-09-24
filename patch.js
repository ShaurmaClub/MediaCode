import fs from 'fs';
let c = fs.readFileSync('src/pages/Leaderboard.jsx', 'utf8');

const helpers = `
const handleOpenProfile = (user) => {
  // placeholder for future profile modal
};

const formatEventsWord = (count) => {
  const n = count % 100;
  const n1 = count % 10;
  if (n > 10 && n < 20) return \`\${count} мероприятий\`;
  if (n1 > 1 && n1 < 5) return \`\${count} мероприятия\`;
  if (n1 === 1) return \`\${count} мероприятие\`;
  return \`\${count} мероприятий\`;
};
`;

c = c.replace(/export default function Leaderboard\(\{ user \}\) \{/, helpers + '\nexport default function Leaderboard({ user }) {');

fs.writeFileSync('src/pages/Leaderboard.jsx', c);
