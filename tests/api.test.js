process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.PORT = '4001';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

describe('Media Center API Tests', () => {
  let baseUrl = 'http://localhost:4001';
  let serverInstance;

  before(async () => {
    const { default: app, server } = await import('../server/index.js');
    serverInstance = server;
  });

  after(async () => {
    if (serverInstance) {
      serverInstance.close();
    }
    // Clean up test db if needed
    const fs = await import('fs');
    try {
      fs.rmSync('./data/test_media.db', { force: true });
      fs.rmSync('./data/test_media.db-shm', { force: true });
      fs.rmSync('./data/test_media.db-wal', { force: true });
    } catch {}
  });

  // Helper for requests maintaining cookies (session)
  class SessionClient {
    constructor() {
      this.cookies = [];
    }

    async request(path, options = {}) {
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };

      if (this.cookies.length > 0) {
        headers['Cookie'] = this.cookies.join('; ');
      }

      const res = await fetch(baseUrl + path, {
        ...options,
        headers
      });

      // Capture cookies
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
      if (setCookies && setCookies.length) {
        for (const sc of setCookies) {
          const cookieVal = sc.split(';')[0];
          this.cookies = this.cookies.filter(c => !c.startsWith(cookieVal.split('=')[0] + '='));
          this.cookies.push(cookieVal);
        }
      }

      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }
  }

  test('GET /api/health should return ok: true', async () => {
    const res = await fetch(baseUrl + '/api/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  test('POST /api/auth/login with wrong credentials should fail', async () => {
    const client = new SessionClient();
    const res = await client.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'student', password: 'WrongPassword!' })
    });
    assert.equal(res.status, 401);
  });

  test('STUDENT flow: login, tasks, apply, record book, leaderboard', async () => {
    const student = new SessionClient();
    const loginRes = await student.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'student', password: 'Demo123!' })
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.user.role, 'STUDENT');

    // Check dashboard
    const dashRes = await student.request('/api/dashboard');
    assert.equal(dashRes.status, 200);
    assert.ok(dashRes.data.user);

    // List tasks
    const tasksRes = await student.request('/api/tasks');
    assert.equal(tasksRes.status, 200);
    assert.ok(Array.isArray(tasksRes.data));

    // Try applying to open task (Task 2: Монтаж промо-ролика)
    const applyRes = await student.request('/api/tasks/2/apply', {
      method: 'POST',
      body: JSON.stringify({ comment: 'Хочу смонтировать видео!' })
    });
    if (applyRes.status !== 200 && applyRes.status !== 201) {
      console.log('Apply error:', applyRes);
    }
    assert.ok(applyRes.status === 200 || applyRes.status === 201);

    // Re-apply should be rejected
    const repeatRes = await student.request('/api/tasks/2/apply', {
      method: 'POST',
      body: JSON.stringify({ comment: 'Повторно' })
    });
    assert.equal(repeatRes.status, 400);

    // Withdraw application
    const withdrawRes = await student.request('/api/tasks/2/withdraw', { method: 'POST' });
    assert.equal(withdrawRes.status, 200);

    // Check record book of self
    const rbRes = await student.request('/api/record-book');
    assert.equal(rbRes.status, 200);
    assert.ok(Array.isArray(rbRes.data.points));

    // Can view another active student's record book
    const otherRbRes = await student.request('/api/record-book/4');
    assert.equal(otherRbRes.status, 200);
    assert.ok(Array.isArray(otherRbRes.data.points));

    // Can view another active student's profile with pointsHistory
    const otherProfileRes = await student.request('/api/users/4');
    assert.equal(otherProfileRes.status, 200);
    assert.ok(Array.isArray(otherProfileRes.data.pointsHistory));

    // Leaderboard
    const lbRes = await student.request('/api/leaderboard');
    assert.equal(lbRes.status, 200);
    assert.ok(Array.isArray(lbRes.data));
  });

  test('SECURITY: Student cannot perform privileged actions', async () => {
    const student = new SessionClient();
    await student.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'student', password: 'Demo123!' })
    });

    // Cannot create task
    const createRes = await student.request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Hacked Task', event_date: '2026-10-10' })
    });
    assert.equal(createRes.status, 403);

    // Cannot award points
    const awardRes = await student.request('/api/points/award', {
      method: 'POST',
      body: JSON.stringify({ user_id: 3, amount: 9999, reason: 'Self-award' })
    });
    assert.equal(awardRes.status, 403);

    // Cannot access audit logs
    const auditRes = await student.request('/api/audit');
    assert.equal(auditRes.status, 403);

    // Cannot create users
    const userRes = await student.request('/api/users', {
      method: 'POST',
      body: JSON.stringify({ login: 'newadmin', password: 'Password123!', role: 'ADMIN' })
    });
    assert.equal(userRes.status, 403);

    // Cannot access STAFF/ADMIN record book
    const staffRbRes = await student.request('/api/record-book/2'); // user 2 is staff
    assert.equal(staffRbRes.status, 403);
  });

  test('PRIVACY: safeUser logic blocks sensitive fields for STUDENT', async () => {
    const student = new SessionClient();
    await student.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: 'student', password: 'Demo123!' }) });
    const listRes = await student.request('/api/users');
    assert.equal(listRes.status, 200);
    const users = listRes.data;
    if (users.length > 0) {
      const userDto = users[0];
      assert.equal(userDto.email, undefined);
      assert.equal(userDto.max_user_id, undefined);
      assert.equal(userDto.password_hash, undefined);
    }
    const staff = new SessionClient();
    await staff.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: 'staff', password: 'Demo123!' }) });
    const staffListRes = await staff.request('/api/users');
    if (staffListRes.data.length > 0) {
      assert.ok('must_change_password' in staffListRes.data[0]);
    }
  });

  test('STAFF flow: create task, select applicant, complete task, prevent duplicate points', async () => {
    const staff = new SessionClient();
    await staff.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'staff', password: 'Demo123!' })
    });

    // Create task
    const taskRes = await staff.request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Тестовое мероприятие для волонтёров',
        description: 'Описание тестового мероприятия',
        category: 'Событие',
        event_date: '2026-11-01',
        start_time: '10:00',
        location: 'Главный холл',
        required_volunteers: 2,
        points: 50,
        status: 'OPEN'
      })
    });
    if(taskRes.status !== 201) console.log('ERROR:', taskRes); assert.equal(taskRes.status, 201);
    const newTaskId = taskRes.data.id;

    // Student applies to the new task
    const student = new SessionClient();
    await student.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'anna', password: 'Demo123!' })
    });
    const applyRes = await student.request(`/api/tasks/${newTaskId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ comment: 'С удовольствием помогу' })
    });
    if(applyRes.status !== 201) console.log('ERROR:', applyRes); assert.equal(applyRes.status, 201);

    // Staff views task details
    const detailRes = await staff.request(`/api/tasks/${newTaskId}`);
    assert.equal(detailRes.status, 200);
    const applicant = detailRes.data.applicants.find(a => a.user_id === 4); // anna is id 4
    assert.ok(applicant);

    // Staff selects student
    const selectRes = await staff.request(`/api/applications/${applicant.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SELECTED' })
    });
    assert.equal(selectRes.status, 200);

    // Staff confirms completion and awards points
    const completeRes = await staff.request(`/api/tasks/${newTaskId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 4 })
    });
    assert.equal(completeRes.status, 200);

    // DUPLICATE PREVENTION: second complete request must fail with 409
    const dupRes = await staff.request(`/api/tasks/${newTaskId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 4 })
    });
    assert.equal(dupRes.status, 409);

    // Staff cannot access admin audit
    const auditRes = await staff.request('/api/audit');
    assert.equal(auditRes.status, 403);
  });

  const testLogin = 'testuser_' + Date.now();
  test('ADMIN flow: user management, edit, reset password, audit log', async () => {
    const admin = new SessionClient();
    await admin.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'admin', password: 'Demo123!' })
    });

    // Create a new user
    const createRes = await admin.request('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        login: testLogin,
        password: 'Password123!',
        role: 'STUDENT',
        first_name: 'Тест',
        last_name: 'Тестов',
        email: `${testLogin}@college.local`,
        group_name: 'media-24',
        year: 1
      })
    });
    if(createRes.status !== 201) console.log('ERROR:', createRes); assert.equal(createRes.status, 201);
    const testUserId = createRes.data.id;

    // Update user
    const updateRes = await admin.request(`/api/users/${testUserId}`, {
      method: 'PATCH',
      body: JSON.stringify({ bio: 'Новая биография', skills: 'SMM, Видео' })
    });
    assert.equal(updateRes.status, 200);

    // Reset password
    const resetRes = await admin.request(`/api/users/${testUserId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'NewSecretPass123!' })
    });
    assert.equal(resetRes.status, 200);

    // Test logging in with the new password
    const testClient = new SessionClient();
    const testLoginRes = await testClient.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: testLogin, password: 'NewSecretPass123!' })
    });
    assert.equal(testLoginRes.status, 200);

    // Admin checks audit logs
    const auditRes = await admin.request('/api/audit');
    assert.equal(auditRes.status, 200);
    assert.ok(Array.isArray(auditRes.data));
    assert.ok(auditRes.data.length > 0);
  });

  test('RECRUITMENT PORTAL: track info, public apply, validation, review, and student creation', async () => {
    // 1. Get track info & verify all 6 tracks
    const allTracks = ['photo', 'video', 'montage', 'design', 'smm', 'content'];
    for (const slug of allTracks) {
      const tRes = await fetch(baseUrl + `/api/public/recruitment/track/${slug}`);
      assert.equal(tRes.status, 200, `Track ${slug} must return 200`);
      const tJson = await tRes.json();
      assert.equal(tJson.track.slug, slug);
      assert.ok(tJson.track.title);
      assert.ok(tJson.track.instructions);
    }

    const trackRes = await fetch(baseUrl + '/api/public/recruitment/track/photo');
    const trackData = await trackRes.json();
    assert.equal(trackData.track.slug, 'photo');
    assert.equal(trackData.track.type, 'PHOTO');
    assert.equal(trackData.track.materials_url, null); // Photo has NO materials button
    assert.ok(Array.isArray(trackData.departments));
    assert.equal(trackData.departments.length, 6);
    assert.deepEqual(trackData.departments, [
      'Учебное отделение «Моссовет»',
      'Учебное отделение «Техно»',
      'Учебное отделение «Датахаб»',
      'Учебное отделение «АртТех»',
      'Учебное отделение «Кибер»',
      'Учебное отделение «Диджитал»'
    ]);
    assert.ok(trackData.maxUploadSizeMB > 0);

    // 1b. Check design track details (1-я Мясниковская улица, дом 16, metro, mandatory registration, no materials button, NO Figma)
    const designTrackRes = await fetch(baseUrl + '/api/public/recruitment/track/design');
    const designTrack = await designTrackRes.json();
    assert.ok(designTrack.track.instructions.includes('1-я Мясниковская улица, дом 16'));
    assert.ok(designTrack.track.instructions.includes('Бульвар Рокоссовского'));
    assert.ok(designTrack.track.instructions.includes('Преображенская площадь'));
    assert.ok(designTrack.track.instructions.includes('Регистрация обязательна'));
    assert.equal(designTrack.track.instructions.includes('Figma'), false);
    assert.equal(designTrack.track.materials_url, null); // Design has NO materials button

    // 1c. Check montage track materials_url (ONLY track with materials, pointing to disk.360.yandex.ru)
    const montageTrackRes = await fetch(baseUrl + '/api/public/recruitment/track/montage');
    const montageTrack = await montageTrackRes.json();
    assert.ok(montageTrack.track.materials_url);
    assert.equal(montageTrack.track.materials_url, 'https://disk.360.yandex.ru/d/SGu5txgr6xDnZw');

    // 1d. Check SMM and Content track canonical names
    const smmTrackRes = await fetch(baseUrl + '/api/public/recruitment/track/smm');
    const smmData = await smmTrackRes.json();
    assert.equal(smmData.track.name, 'СММ');
    assert.equal(smmData.track.title, 'Тестовое задание — СММ');
    assert.equal(smmData.track.materials_url, null);

    const contentTrackRes = await fetch(baseUrl + '/api/public/recruitment/track/content');
    const contentData = await contentTrackRes.json();
    assert.equal(contentData.track.name, 'Ведущий / корреспондент');
    assert.equal(contentData.track.title, 'Тестовое задание — ведущий / корреспондент');
    assert.equal(contentData.track.materials_url, null);

    // 2. Track 404
    const notFoundTrack = await fetch(baseUrl + '/api/public/recruitment/track/unknown_track');
    assert.equal(notFoundTrack.status, 404);

    // 3. Validation: Missing consent must fail
    const noConsentRes = await fetch(baseUrl + '/api/public/recruitment/apply/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Петров Петр Петрович',
        department: trackData.departments[0],
        group_name: 'ИС-21',
        phone: '+7 999 111-22-33',
        max_contact: '+7 900 123-45-67',
        submission_url: 'https://disk.yandex.ru/d/test12345',
        consent: false
      })
    });
    assert.equal(noConsentRes.status, 400);

    // 3b. Validation: Non-Cyrillic FIO must fail with exact Russian error
    const nonCyrillicFioRes = await fetch(baseUrl + '/api/public/recruitment/apply/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'John Doe',
        department: trackData.departments[0],
        group_name: 'ИС-21',
        phone: '+7 999 111-22-33',
        max_contact: '+7 900 123-45-67',
        submission_url: 'https://disk.yandex.ru/d/test12345',
        phone_is_max: true, consent: true
      })
    });
    assert.equal(nonCyrillicFioRes.status, 400);
    const nonCyrillicData = await nonCyrillicFioRes.json();
    assert.equal(nonCyrillicData.error, 'Введите ФИО русскими буквами');

    // 3c. Validation: FIO with numbers must fail
    const numFioRes = await fetch(baseUrl + '/api/public/recruitment/apply/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Иван123 Иванов',
        department: trackData.departments[0],
        group_name: 'ИС-21',
        phone: '+7 999 111-22-33',
        max_contact: '+7 900 123-45-67',
        submission_url: 'https://disk.yandex.ru/d/test12345',
        phone_is_max: true, consent: true
      })
    });
    assert.equal(numFioRes.status, 400);

    // 4. Validation: Missing submission material must fail
    const noMaterialRes = await fetch(baseUrl + '/api/public/recruitment/apply/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Петров Петр Петрович',
        department: trackData.departments[0],
        group_name: 'ИС-21',
        phone: '+7 999 111-22-33',
        max_contact: '+7 900 123-45-67',
        phone_is_max: true, consent: true
      })
    });
    assert.equal(noMaterialRes.status, 400);

    // 4b. Validation: Invalid Russian phone must fail
    const invalidPhoneRes = await fetch(baseUrl + '/api/public/recruitment/apply/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Петров Петр Петрович',
        department: trackData.departments[0],
        group_name: 'ИС-21',
        phone: '123-bad-phone',
        max_contact: '+7 900 123-45-67',
        submission_url: 'https://disk.yandex.ru/d/test12345',
        phone_is_max: true, consent: true
      })
    });
    assert.equal(invalidPhoneRes.status, 400);

    // 4c. Photo validation: Photo requires either 10 JPEG files or valid Yandex Disk folder
    const badPhotoRes = await fetch(baseUrl + '/api/public/recruitment/apply/photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Иван Фотографов',
        department: trackData.departments[0],
        group_name: 'ФТ-11',
        phone: '+7 999 111-22-33',
        max_contact: '+7 900 123-45-67',
        submission_url: 'https://not-yandex.com/invalid-link',
        phone_is_max: true, consent: true
      })
    });
    assert.equal(badPhotoRes.status, 400);

    // 4c-2. Successful Photo submission via Yandex Disk link
    const yandexPhotoRes = await fetch(baseUrl + '/api/public/recruitment/apply/photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Иван Дисков',
        department: trackData.departments[0],
        group_name: 'ФТ-11',
        phone: '+7 999 111-22-33',
        phone_is_max: 'true',
        submission_url: 'https://disk.yandex.ru/d/test-folder',
        phone_is_max: true, consent: true
      })
    });
    if(yandexPhotoRes.status !== 201) console.log('ERROR:', yandexPhotoRes); assert.equal(yandexPhotoRes.status, 201);
    const yandexPhotoData = await yandexPhotoRes.json();
    assert.match(yandexPhotoData.public_id, /^MC-P-\d{4}$/);

    // 4d. Successful Photo submission with 10 JPEG files
    const photoFormData = new FormData();
    photoFormData.append('full_name', 'Иван Фотографов');
    photoFormData.append('department', trackData.departments[0]);
    photoFormData.append('group_name', 'ФТ-11');
    photoFormData.append('phone', '+7 (999) 777-88-99');
    photoFormData.append('phone_is_max', 'true');
    photoFormData.append('consent', 'true');
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    for (let i = 1; i <= 10; i++) {
      const blob = new Blob([jpegHeader, 'photo content ' + i], { type: 'image/jpeg' });
      photoFormData.append('files', blob, `shot_${i}.jpg`);
    }
    const goodPhotoRes = await fetch(baseUrl + '/api/public/recruitment/apply/photo', {
      method: 'POST',
      body: photoFormData
    });
    if(goodPhotoRes.status !== 201) console.log('ERROR:', goodPhotoRes); assert.equal(goodPhotoRes.status, 201);
    const goodPhotoData = await goodPhotoRes.json();
    assert.match(goodPhotoData.public_id, /^MC-P-\d{4}$/);

    // 4c. phone_is_max: Checkbox automatically adopts verified phone as MAX contact
    const phoneIsMaxRes = await fetch(baseUrl + '/api/public/recruitment/apply/smm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Елена Контентщица',
        department: trackData.departments[0],
        group_name: 'ГД-11',
        phone: '89161234567',
        phone_is_max: true,
        submission_text: 'Яркий пост о наборе первокурсников в МедиаКод! 🚀 Рубрика 1: день из жизни колледжа',
        phone_is_max: true, consent: true
      })
    });
    if(phoneIsMaxRes.status !== 201) console.log('ERROR:', phoneIsMaxRes); assert.equal(phoneIsMaxRes.status, 201);
    const phoneIsMaxData = await phoneIsMaxRes.json();
    assert.match(phoneIsMaxData.public_id, /^MC-S-\d{4}$/);

    // 4d. Strict Track Slug binding: request body track is ignored, route param is enforced
    const strictSlugRes = await fetch(baseUrl + '/api/public/recruitment/apply/montage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: 1, // Attempted tampering
        track: 'photo', // Attempted tampering
        full_name: 'Артем Монтажер',
        department: trackData.departments[0],
        group_name: 'МТ-21',
        phone: '+7 900 123-45-67',
        max_contact: '+7 900 123-45-67',
        submission_url: 'https://disk.yandex.ru/d/artem_montage_test',
        phone_is_max: true, consent: true
      })
    });
    if(strictSlugRes.status !== 201) console.log('ERROR strictSlugRes:', await strictSlugRes.text()); assert.equal(strictSlugRes.status, 201);
    const strictSlugData = await strictSlugRes.json();
    assert.match(strictSlugData.public_id, /^MC-M-\d{4}$/);

    // 4e. Yandex Disk 360 link (disk.360.yandex.ru) is accepted
    const disk360Res = await fetch(baseUrl + '/api/public/recruitment/apply/montage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Дмитрий Монтажев',
        department: trackData.departments[0],
        group_name: 'ИБС-111',
        phone: '+7 900 360-11-33',
        submission_url: 'https://disk.360.yandex.ru/d/SGu5txgr6xDnZw',
        phone_is_max: true, consent: true
      })
    });
    if(disk360Res.status !== 201) console.log('ERROR:', disk360Res); assert.equal(disk360Res.status, 201);
    const disk360Data = await disk360Res.json();
    assert.match(disk360Data.public_id, /^MC-M-\d{4}$/);

    // 4f. Non-Yandex link must fail with 400
    const nonYandexRes = await fetch(baseUrl + '/api/public/recruitment/apply/montage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Дмитрий Монтажев',
        department: trackData.departments[0],
        group_name: 'ИБС-111',
        phone: '+7 900 360-11-22',
        submission_url: 'https://drive.google.com/drive/folders/sample',
        phone_is_max: true, consent: true
      })
    });
    assert.equal(nonYandexRes.status, 400);

    // 5. Successful public application submission
    const candidateName = 'Игорь Тестовый Кандидат';
    const applyRes = await fetch(baseUrl + '/api/public/recruitment/apply/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: candidateName,
        department: trackData.departments[0],
        group_name: 'МТ-11',
        phone: '+7 999 555-44-33',
        phone_is_max: true,
        portfolio_url: 'https://disk.yandex.ru/d/test_portfolio',
        submission_url: 'https://disk.yandex.ru/d/video_assignment',
        comment: 'Снял и смонтировал короткий ролик о колледже',
        phone_is_max: true, consent: true
      })
    });
    if(applyRes.status !== 201) console.log('ERROR:', applyRes); assert.equal(applyRes.status, 201);
    const applyResult = await applyRes.json();
    assert.equal(applyResult.ok, true);
    assert.ok(applyResult.public_id);
    assert.match(applyResult.public_id, /^MC-V-\d{4}$/);

    // 6. Security: Student role cannot view recruitment review
    const student = new SessionClient();
    await student.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'student', password: 'Demo123!' })
    });
    const studentForbidden = await student.request('/api/recruitment/applications');
    assert.equal(studentForbidden.status, 403);

    // 7. Staff logs in and reviews applications
    const staff = new SessionClient();
    await staff.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: 'staff', password: 'Demo123!' })
    });

    const listRes = await staff.request('/api/recruitment/applications');
    assert.equal(listRes.status, 200);
    assert.ok(listRes.data.applications.length > 0);
    assert.ok(listRes.data.pendingCount > 0);

    // Find the application we just created
    const foundApp = listRes.data.applications.find(a => a.public_id === applyResult.public_id);
    assert.ok(foundApp);
    assert.equal(foundApp.full_name, candidateName);
    assert.equal(foundApp.phone, '+79995554433');

    // 8. Staff views single application details
    const singleRes = await staff.request(`/api/recruitment/applications/${foundApp.id}`);
    assert.equal(singleRes.status, 200);
    assert.equal(singleRes.data.application.public_id, applyResult.public_id);
    assert.equal(singleRes.data.application.max_contact, '+79995554433');

    // 9. Staff changes status to IN_REVIEW
    const inReviewRes = await staff.request(`/api/recruitment/applications/${foundApp.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'IN_REVIEW' })
    });
    assert.equal(inReviewRes.status, 200);

    // 10. Staff approves candidate without password (auto-generating secure random password, no Demo123!)
    const approveRes = await staff.request(`/api/recruitment/applications/${foundApp.id}/approve-and-create-user`, {
      method: 'POST',
      body: JSON.stringify({}) // no password provided
    });
    if(approveRes.status !== 201) console.log('ERROR:', approveRes); assert.equal(approveRes.status, 201);
    const createdLogin = approveRes.data.login || approveRes.data.user.login;
    const tempPassword = approveRes.data.temporaryPassword || approveRes.data.initialPassword;
    assert.ok(createdLogin);
    assert.ok(tempPassword);
    assert.notEqual(tempPassword, 'Demo123!');
    assert.match(tempPassword, /^MC_[a-f0-9]{8}Aa1!$/);
    assert.equal(approveRes.data.user.email, null);
    assert.equal(approveRes.data.user.bio.includes('Принят по заявке'), false);
    assert.equal(approveRes.data.user.role, 'STUDENT');

    // 11. Duplicate approval prevention: Second attempt must fail with 400
    const dupApproveRes = await staff.request(`/api/recruitment/applications/${foundApp.id}/approve-and-create-user`, {
      method: 'POST',
      body: JSON.stringify({ password: 'CustomPassword123!' })
    });
    assert.equal(dupApproveRes.status, 400);

    // 12. Newly created student logs in with temporary password and verifies account & welcome points
    const newStudent = new SessionClient();
    const newLoginRes = await newStudent.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: createdLogin, password: tempPassword })
    });
    assert.equal(newLoginRes.status, 200);
    assert.equal(newLoginRes.data.user.role, 'STUDENT');
    assert.equal(newLoginRes.data.user.must_change_password, true);

    // 13. Student changes password on first login
    const firstChangeRes = await newStudent.request('/api/auth/first-login-password-change', {
      method: 'POST',
      body: JSON.stringify({ newPassword: 'NewSecurePass2026!' })
    });
    assert.equal(firstChangeRes.status, 200);
    assert.equal(firstChangeRes.data.user.must_change_password, false);

    // Check dashboard of new student has welcome bonus points
    const newDash = await newStudent.request('/api/dashboard');
    assert.equal(newDash.status, 200);
    assert.equal(newDash.data.user.totalPoints, 10);
  });

  test('FormData regression for Task Submission', async () => {
    const loginStu = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({login: 'student', password: 'Demo123!'}) });
    const stuCookie = loginStu.headers.get('set-cookie');
    
    // Create a new task by staff
    const loginStaff = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({login: 'staff', password: 'Demo123!'}) });
    const staffCookie = loginStaff.headers.get('set-cookie');
    
    const taskRes = await fetch(baseUrl + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': staffCookie },
      body: JSON.stringify({ title: 'Test Task', points: 10, required_volunteers: 5, event_date: '2026-10-10', status: 'OPEN' })
    });
    const taskData = await taskRes.json();
    const taskId = taskData.id || taskData.task?.id || taskData.taskId;
    if (!taskId) throw new Error('Could not create task: ' + JSON.stringify(taskData));

    // Student applies
    const applyRes = await fetch(baseUrl + '/api/tasks/' + taskId + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': stuCookie }, body: JSON.stringify({}) });
    const applyData = await applyRes.json();
    console.log('APPLY DATA:', applyData);
    
    // Staff finds the application and selects
    const listRes = await fetch(baseUrl + '/api/tasks/' + taskId, { headers: { 'Cookie': staffCookie } });
    const listData = await listRes.json();
    const taskObj = listData.task || listData;
    if (!taskObj.applicants) throw new Error('No applicants field: ' + JSON.stringify(listData));
    const found = taskObj.applicants.find(a => a.first_name === 'Иван');
if (!found) throw new Error('App not found! Applications: ' + JSON.stringify(listData.task.applications));
const appId = found.id;
    
    const selectRes = await fetch(baseUrl + '/api/applications/' + appId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Cookie': staffCookie },
      body: JSON.stringify({ status: 'SELECTED' })
    });
    if (selectRes.status !== 200) throw new Error('Select failed: ' + await selectRes.text());

    // Build FormData
    const FormData = globalThis.FormData;
    const { Blob } = globalThis;
    const form = new FormData();
    form.append('submission_method', 'file');
    form.append('comment', 'My file submission');
    form.append('file', new Blob(['test file content'], { type: 'text/plain' }), 'test.txt');

    // Submit
    const submitRes = await fetch(baseUrl + `/api/tasks/${taskId}/submit-completion`, {
      method: 'POST',
      headers: { 'Cookie': stuCookie },
      body: form
    });
    if (submitRes.status !== 200) console.log(await submitRes.clone().json());
    assert.equal(submitRes.status, 200, 'FormData submission should succeed');
    const submitData = await submitRes.json();
    console.log('SUBMIT DATA:', submitData);

    // Try downloading
    let filePath = null;
    if (submitData.version && submitData.version.file_path) filePath = submitData.version.file_path;
    else if (submitData.file_path) filePath = submitData.file_path;
    else {
      // Find manually
      const db = (await import('../server/db.js')).default;
      const v = db.prepare('SELECT file_path FROM application_versions WHERE application_id = ? ORDER BY id DESC LIMIT 1').get(appId);
      filePath = v.file_path;
    }
    const staffDownloadRes = await fetch(baseUrl + '/api/tasks/files/download?path=' + encodeURIComponent(filePath), {
      headers: { 'Cookie': staffCookie }
    });
    assert.equal(staffDownloadRes.status, 200, 'Staff should download');

    // Unauthorized student download
    const loginStu2 = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({login: 'anna', password: 'Demo123!'}) });
    const stu2Cookie = loginStu2.headers.get('set-cookie');
    const stu2DownloadRes = await fetch(baseUrl + '/api/tasks/files/download?path=' + encodeURIComponent(filePath), {
      headers: { 'Cookie': stu2Cookie }
    });
    assert.equal(stu2DownloadRes.status, 403, 'Other student should get 403');
  });

  test('MAX Mini App & Password Reset Request', async () => {
    // 1. GET MAX Config
    const configRes = await fetch(baseUrl + '/api/max/config');
    assert.equal(configRes.status, 200);
    const configData = await configRes.json();
    assert.ok(configData.config);
    assert.ok(configData.config.botUsername);

    // 2. Password reset request
    const resetReqRes = await fetch(baseUrl + '/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginOrContact: 'student' })
    });
    assert.equal(resetReqRes.status, 200);
    const resetReqData = await resetReqRes.json();
    assert.equal(resetReqData.ok, true);

    // 3. MAX Mini App simulated login
    const maxLoginRes = await fetch(baseUrl + '/api/auth/max-mini-app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: 'user=%7B%22id%22%3A987654%2C%22username%22%3A%22ivan_petrov%22%2C%22first_name%22%3A%22%D0%98%D0%B2%D0%B0%D0%BD%22%7D&auth_date=1720000000&hash=mockhash'
      })
    });
    assert.equal(maxLoginRes.status, 200);
    const maxLoginData = await maxLoginRes.json();
    assert.equal(maxLoginData.user.login, 'student');
    assert.equal(maxLoginData.user.max_contact_verified, true);

      // 4. MAX Identity Uniqueness
      const loginStu = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({login: 'student', password: 'Demo123!'}) });
      const stuCookie = loginStu.headers.get('set-cookie');
      const loginStaff = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({login: 'staff', password: 'Demo123!'}) });
      const staffCookie = loginStaff.headers.get('set-cookie');

      const link1 = await fetch(baseUrl + '/api/user/link-max', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': stuCookie },
        body: JSON.stringify({ initData: 'user=%7B%22id%22%3A123123%2C%22username%22%3A%22new_max%22%7D&hash=mockhash' })
      });
      assert.equal(link1.status, 200);

      const link2 = await fetch(baseUrl + '/api/user/link-max', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': staffCookie },
        body: JSON.stringify({ initData: 'user=%7B%22id%22%3A123123%2C%22username%22%3A%22new_max%22%7D&hash=mockhash' })
      });
      assert.equal(link2.status, 409);
    });
});

