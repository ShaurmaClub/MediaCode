import fs from 'fs';
let c = fs.readFileSync('src/pages/SettingsPage.jsx', 'utf8');

const s = `  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await api('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(profileForm)
      });
      setUser(res.user);
      toast.success('Данные вашего профиля успешно обновлены!');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingProfile(false);
    }
  };`;

const rep = `  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const payload = { ...profileForm };
      if (user.role === 'STUDENT') {
        delete payload.phone;
      }
      const res = await api('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setUser(res.user);
      toast.success('Данные вашего профиля успешно обновлены!');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingProfile(false);
    }
  };`;

if (c.includes(s)) c = c.replace(s, rep);
else if (c.includes(s.replace(/\r\n/g, '\n'))) c = c.replace(s.replace(/\r\n/g, '\n'), rep);
else console.log("Not found");

fs.writeFileSync('src/pages/SettingsPage.jsx', c);
