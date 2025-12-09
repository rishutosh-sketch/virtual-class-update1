const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const dbPath = process.env.DB_FILE || path.join(__dirname, 'db.sqlite');
const usePg = !!process.env.DATABASE_URL || !!process.env.PGHOST;
let pool = null;
let db = null;
function q(sql){ let i=0; return String(sql).replace(/\?/g,()=>'$'+(++i)); }
if (usePg) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined });
  db = {
    run: function(sql, params, cb){
      pool.query(q(sql), params || []).then(r=>{ if(cb) cb.call({ changes: r.rowCount }, null); }).catch(e=>{ if(cb) cb(e); });
    },
    get: function(sql, params, cb){
      pool.query(q(sql), params || []).then(r=>cb(null, (r.rows||[])[0]||null)).catch(e=>cb(e));
    },
    all: function(sql, params, cb){
      pool.query(q(sql), params || []).then(r=>cb(null, r.rows||[])).catch(e=>cb(e));
    }
  };
} else {
  db = new sqlite3.Database(dbPath);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.disable('x-powered-by');

if (process.env.CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN);
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
} else {
  app.use((req, res, next) => {
    const o = String(req.headers.origin || '');
    if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o)) {
      res.header('Access-Control-Allow-Origin', o);
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(200);
    }
    next();
  });
}

if (usePg) {
  (async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE, passwordHash TEXT, role TEXT)');
    await pool.query('CREATE TABLE IF NOT EXISTS enrollments (id SERIAL PRIMARY KEY, user_id INTEGER, title TEXT, instructor TEXT, category TEXT, course_id INTEGER, created_at TEXT)');
    await pool.query('CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, title TEXT, instructor TEXT, category TEXT, level TEXT, duration TEXT, description TEXT, image_url TEXT)');
    await pool.query('CREATE TABLE IF NOT EXISTS lessons (id SERIAL PRIMARY KEY, course_id INTEGER, title TEXT, content TEXT, order_index INTEGER)');
    await pool.query('CREATE TABLE IF NOT EXISTS lesson_progress (user_id INTEGER, lesson_id INTEGER, completed INTEGER, completed_at TEXT, PRIMARY KEY(user_id, lesson_id))');
    await pool.query('CREATE TABLE IF NOT EXISTS quizzes (id SERIAL PRIMARY KEY, course_id INTEGER, title TEXT)');
    await pool.query('CREATE TABLE IF NOT EXISTS quiz_questions (id SERIAL PRIMARY KEY, quiz_id INTEGER, prompt TEXT, options TEXT, correct_option INTEGER)');
    await pool.query('CREATE TABLE IF NOT EXISTS quiz_attempts (id SERIAL PRIMARY KEY, quiz_id INTEGER, user_id INTEGER, answers TEXT, score INTEGER, created_at TEXT)');
    await pool.query('CREATE TABLE IF NOT EXISTS assignments (id SERIAL PRIMARY KEY, course_id INTEGER, title TEXT, description TEXT)');
    await pool.query('CREATE TABLE IF NOT EXISTS submissions (id SERIAL PRIMARY KEY, assignment_id INTEGER, user_id INTEGER, content TEXT, feedback TEXT, created_at TEXT)');

    const s1 = await pool.query('SELECT COUNT(*)::int as c FROM users WHERE email = $1', ['student@test.com']);
    if (!s1.rows[0] || s1.rows[0].c === 0) { const hash = bcrypt.hashSync('123456', 10); await pool.query('INSERT INTO users (name,email,passwordHash,role) VALUES ($1,$2,$3,$4)', ['Student Demo','student@test.com',hash,'student']); }
    const s2 = await pool.query('SELECT COUNT(*)::int as c FROM users WHERE email = $1', ['instructor@test.com']);
    if (!s2.rows[0] || s2.rows[0].c === 0) { const hash = bcrypt.hashSync('123456', 10); await pool.query('INSERT INTO users (name,email,passwordHash,role) VALUES ($1,$2,$3,$4)', ['Instructor Demo','instructor@test.com',hash,'instructor']); }
    const s3 = await pool.query('SELECT COUNT(*)::int as c FROM users WHERE email = $1', ['admin@test.com']);
    if (!s3.rows[0] || s3.rows[0].c === 0) { const hash = bcrypt.hashSync('123456', 10); await pool.query('INSERT INTO users (name,email,passwordHash,role) VALUES ($1,$2,$3,$4)', ['Admin Demo','admin@test.com',hash,'admin']); }

    const lcnt = await pool.query('SELECT COUNT(*)::int as c FROM lessons');
    if (!lcnt.rows[0] || lcnt.rows[0].c === 0) {
      const seedLessons = [
        [1, 'Intro to the Web', 'How the web works, HTTP, browsers', 1],
        [1, 'HTML Essentials', 'Semantic HTML, structure and accessibility basics', 2],
        [1, 'CSS Basics', 'Selectors, layout, responsive design', 3],
        [1, 'JavaScript Basics', 'Variables, functions, DOM', 4],
        [1, 'Project: Landing Page', 'Build a responsive landing page', 5],
        [2, 'ES6+ Features', 'Let/const, arrow functions, modules', 1],
        [2, 'Async Patterns', 'Promises, async/await, error handling', 2],
        [2, 'DOM Mastery', 'DOM APIs, events, performance', 3],
        [2, 'Tooling', 'Bundlers, linters, formatters', 4]
      ];
      for (const l of seedLessons) { await pool.query('INSERT INTO lessons (course_id,title,content,order_index) VALUES ($1,$2,$3,$4)', l); }
    }

    await pool.query('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS course_id INTEGER');
    await pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS image_url TEXT');

    const ccnt = await pool.query('SELECT COUNT(*)::int as c FROM courses');
    if (!ccnt.rows[0] || ccnt.rows[0].c === 0) {
      const seedCourses = [
        [1, 'Web Development Mastery', 'John Smith', 'Web Dev', 'Beginner', '12h', 'Build modern responsive websites using HTML, CSS, and JS.', 'https://upload.wikimedia.org/wikipedia/commons/6/61/HTML5_logo_and_wordmark.svg'],
        [2, 'JavaScript Superpowers', 'Sarah Johnson', 'Programming', 'Intermediate', '10h', 'Master ES6+, async patterns, and practical DOM workflows.', 'https://share.google/images/Q4dZtlgWHmiK8w6Of'],
        [3, 'Python Domination', 'Mike Davis', 'Coding', 'Beginner', '14h', 'From basics to OOP and packages with hands-on labs.', 'https://upload.wikimedia.org/wikipedia/commons/f/f8/Python_logo_and_wordmark.svg'],
        [4, 'Data Science Revolution', 'Emily Chen', 'Data Science', 'Advanced', '16h', 'Statistics, pandas, visualization, and ML foundations.', 'https://upload.wikimedia.org/wikipedia/commons/1/12/Chart_bar_black.svg'],
        [5, 'UI/UX Design Legends', 'Alex Rivera', 'Design', 'Beginner', '8h', 'Human-centered design, wireframes, and prototyping best practices.', 'https://upload.wikimedia.org/wikipedia/commons/3/33/Figma-logo.svg'],
        [6, 'MongoDB Database Beast', 'Robert Kumar', 'Database', 'Intermediate', '9h', 'Schemas, queries, indexes, and performance tuning.', 'https://upload.wikimedia.org/wikipedia/commons/9/93/MongoDB_Logo.svg']
      ];
      for (const c of seedCourses) { await pool.query('INSERT INTO courses (id,title,instructor,category,level,duration,description,image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', c); }
    }

    const moreCourses = [
      { id: 7, title: 'React Essentials', instructor: 'Nina Patel', category: 'Web Dev', level: 'Intermediate', duration: '11h', description: 'Components, hooks, and state management fundamentals.', image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/a7/React-icon.svg' },
      { id: 8, title: 'TypeScript for Pros', instructor: 'David Lee', category: 'Programming', level: 'Intermediate', duration: '9h', description: 'Types, generics, interfaces, and integrating with JS projects.', image_url: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/Typescript_logo_2020.svg' },
      { id: 9, title: 'Node.js API Design', instructor: 'Priya Sharma', category: 'Backend', level: 'Intermediate', duration: '12h', description: 'REST patterns, auth, validation, and performance.', image_url: 'https://upload.wikimedia.org/wikipedia/commons/d/d9/Node.js_logo.svg' },
      { id: 10, title: 'SQL & Data Modeling', instructor: 'Luis Garcia', category: 'Database', level: 'Beginner', duration: '10h', description: 'Relational fundamentals, SQL queries, and schema design.', image_url: '' },
      { id: 12, title: 'DevOps Basics', instructor: 'Tom Nguyen', category: 'DevOps', level: 'Beginner', duration: '7h', description: 'CI/CD, pipelines, environments, and observability.', image_url: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Git_icon.svg' }
    ];
    for (const c of moreCourses) {
      const r2 = await pool.query('SELECT id FROM courses WHERE title = $1', [c.title]);
      let cid = r2.rows[0] && r2.rows[0].id ? r2.rows[0].id : c.id;
      if (!r2.rows[0]) {
        const ins = await pool.query('INSERT INTO courses (title,instructor,category,level,duration,description,image_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [c.title, c.instructor, c.category, c.level, c.duration, c.description, c.image_url || '']);
        cid = ins.rows[0].id;
      } else if (c.image_url) {
        await pool.query('UPDATE courses SET image_url = $1 WHERE id = $2', [c.image_url, cid]);
      }
      const r3 = await pool.query('SELECT COUNT(*)::int as c FROM lessons WHERE course_id = $1', [cid]);
      const needSeed = !r3.rows[0] || r3.rows[0].c === 0;
      if (needSeed) {
        if (cid === 7) {
          await pool.query('INSERT INTO lessons (course_id,title,content,order_index) VALUES ($1,$2,$3,$4)', [cid, 'Intro to React', 'JSX, components, props', 1]);
          await pool.query('INSERT INTO lessons (course_id,title,content,order_index) VALUES ($1,$2,$3,$4)', [cid, 'Hooks 101', 'useState, useEffect basics', 2]);
          await pool.query('INSERT INTO lessons (course_id,title,content,order_index) VALUES ($1,$2,$3,$4)', [cid, 'State Management', 'Lifting state, context', 3]);
        } else if (cid === 9) {
          await pool.query('INSERT INTO lessons (course_id,title,content,order_index) VALUES ($1,$2,$3,$4)', [cid, 'Express Basics', 'Routing and middleware', 1]);
          await pool.query('INSERT INTO lessons (course_id,title,content,order_index) VALUES ($1,$2,$3,$4)', [cid, 'Authentication', 'JWT, sessions, security', 2]);
          await pool.query('INSERT INTO lessons (course_id,title,content,order_index) VALUES ($1,$2,$3,$4)', [cid, 'Validation & Errors', 'Input validation and error handling', 3]);
        } else {
          await pool.query('INSERT INTO lessons (course_id,title,content,order_index) VALUES ($1,$2,$3,$4)', [cid, 'Course Overview', 'What you will learn', 1]);
          await pool.query('INSERT INTO lessons (course_id,title,content,order_index) VALUES ($1,$2,$3,$4)', [cid, 'First Steps', 'Setup and hello world', 2]);
        }
      }
    }

    const setImages = [
      ['Web Development Mastery','https://upload.wikimedia.org/wikipedia/commons/6/61/HTML5_logo_and_wordmark.svg'],
      ['JavaScript Superpowers','https://upload.wikimedia.org/wikipedia/commons/6/6a/JavaScript-logo.png'],
      ['Python Domination','https://upload.wikimedia.org/wikipedia/commons/f/f8/Python_logo_and_wordmark.svg'],
      ['Data Science Revolution','https://upload.wikimedia.org/wikipedia/commons/1/12/Chart_bar_black.svg'],
      ['UI/UX Design Legends','https://upload.wikimedia.org/wikipedia/commons/3/33/Figma-logo.svg'],
      ['MongoDB Database Beast','https://upload.wikimedia.org/wikipedia/commons/9/93/MongoDB_Logo.svg']
    ];
    for (const [title,url] of setImages) {
      await pool.query("UPDATE courses SET image_url = $1 WHERE title = $2 AND (image_url IS NULL OR image_url = '')", [url, title]);
    }
    await pool.query("UPDATE courses SET image_url = '/images/sql.jpg' WHERE title = 'SQL & Data Modeling'");
    await pool.query("UPDATE courses SET image_url = 'https://upload.wikimedia.org/wikipedia/commons/9/93/MongoDB_Logo.svg' WHERE title LIKE '%MongoDB%'");

    const toRemove = [16,17];
    const qs = await pool.query('SELECT id FROM quizzes WHERE course_id = ANY($1::int[])', [toRemove]);
    for (const qrow of (qs.rows||[])) { await pool.query('DELETE FROM quiz_questions WHERE quiz_id = $1', [qrow.id]); }
    await pool.query('DELETE FROM quizzes WHERE course_id = ANY($1::int[])', [toRemove]);
    const as = await pool.query('SELECT id FROM assignments WHERE course_id = ANY($1::int[])', [toRemove]);
    for (const arow of (as.rows||[])) { await pool.query('DELETE FROM submissions WHERE assignment_id = $1', [arow.id]); }
    await pool.query('DELETE FROM assignments WHERE course_id = ANY($1::int[])', [toRemove]);
    await pool.query('DELETE FROM lesson_progress WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = ANY($1::int[]))', [toRemove]);
    await pool.query('DELETE FROM lessons WHERE course_id = ANY($1::int[])', [toRemove]);
    await pool.query('DELETE FROM enrollments WHERE course_id = ANY($1::int[])', [toRemove]);
    await pool.query('DELETE FROM courses WHERE id = ANY($1::int[])', [toRemove]);
    await pool.query("UPDATE courses SET image_url = 'https://share.google/images/Q4dZtlgWHmiK8w6Of' WHERE title = 'JavaScript Superpowers'");

    const toRemove2 = [18,19];
    const qs2 = await pool.query('SELECT id FROM quizzes WHERE course_id = ANY($1::int[])', [toRemove2]);
    for (const qrow of (qs2.rows||[])) { await pool.query('DELETE FROM quiz_questions WHERE quiz_id = $1', [qrow.id]); }
    await pool.query('DELETE FROM quizzes WHERE course_id = ANY($1::int[])', [toRemove2]);
    const as2 = await pool.query('SELECT id FROM assignments WHERE course_id = ANY($1::int[])', [toRemove2]);
    for (const arow of (as2.rows||[])) { await pool.query('DELETE FROM submissions WHERE assignment_id = $1', [arow.id]); }
    await pool.query('DELETE FROM assignments WHERE course_id = ANY($1::int[])', [toRemove2]);
    await pool.query('DELETE FROM lesson_progress WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = ANY($1::int[]))', [toRemove2]);
    await pool.query('DELETE FROM lessons WHERE course_id = ANY($1::int[])', [toRemove2]);
    await pool.query('DELETE FROM enrollments WHERE course_id = ANY($1::int[])', [toRemove2]);
    await pool.query('DELETE FROM courses WHERE id = ANY($1::int[])', [toRemove2]);

    const cfr = await pool.query('SELECT id FROM courses WHERE title = $1', ['Cloud Fundamentals']);
    if (cfr.rows[0] && cfr.rows[0].id) {
      const cid = cfr.rows[0].id;
      await pool.query('DELETE FROM lesson_progress WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = $1)', [cid]);
      await pool.query('DELETE FROM lessons WHERE course_id = $1', [cid]);
      await pool.query('DELETE FROM enrollments WHERE course_id = $1', [cid]);
      const qs3 = await pool.query('SELECT id FROM quizzes WHERE course_id = $1', [cid]);
      for (const qrow of (qs3.rows||[])) { await pool.query('DELETE FROM quiz_questions WHERE quiz_id = $1', [qrow.id]); }
      await pool.query('DELETE FROM quizzes WHERE course_id = $1', [cid]);
      const as3 = await pool.query('SELECT id FROM assignments WHERE course_id = $1', [cid]);
      for (const arow of (as3.rows||[])) { await pool.query('DELETE FROM submissions WHERE assignment_id = $1', [arow.id]); }
      await pool.query('DELETE FROM assignments WHERE course_id = $1', [cid]);
      await pool.query('DELETE FROM courses WHERE id = $1', [cid]);
    }

    const qc = await pool.query('SELECT COUNT(*)::int as c FROM quizzes');
    if (!qc.rows[0] || qc.rows[0].c === 0) {
      await pool.query('INSERT INTO quizzes (id,course_id,title) VALUES ($1,$2,$3)', [1,1,'Basics Check']);
      await pool.query('INSERT INTO quiz_questions (quiz_id,prompt,options,correct_option) VALUES ($1,$2,$3,$4)', [1,'HTML stands for?', JSON.stringify(['Hyperlinks and Text Markup Language','Hyper Text Markup Language','Home Tool Markup Language']), 1]);
      await pool.query('INSERT INTO quiz_questions (quiz_id,prompt,options,correct_option) VALUES ($1,$2,$3,$4)', [1,'CSS is used for?', JSON.stringify(['Styling','Database','Networking']), 0]);
      await pool.query('INSERT INTO quizzes (id,course_id,title) VALUES ($1,$2,$3)', [2,2,'JavaScript Core']);
      await pool.query('INSERT INTO quiz_questions (quiz_id,prompt,options,correct_option) VALUES ($1,$2,$3,$4)', [2,'let vs var: let is?', JSON.stringify(['Function-scoped','Block-scoped','Global only']), 1]);
    }

    const ac = await pool.query('SELECT COUNT(*)::int as c FROM assignments');
    if (!ac.rows[0] || ac.rows[0].c === 0) {
      await pool.query('INSERT INTO assignments (id,course_id,title,description) VALUES ($1,$2,$3,$4)', [1,1,'Build a Landing Page','Create a simple responsive landing page with HTML and CSS.']);
      await pool.query('INSERT INTO assignments (id,course_id,title,description) VALUES ($1,$2,$3,$4)', [2,2,'Write Async Functions','Implement two async functions using fetch and handle errors.']);
    }
  })();
} else {
  db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, passwordHash TEXT, role TEXT)');
    db.run('CREATE TABLE IF NOT EXISTS enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, instructor TEXT, category TEXT, course_id INTEGER, created_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id))');
    db.run('CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, instructor TEXT, category TEXT, level TEXT, duration TEXT, description TEXT, image_url TEXT)');
    db.run('CREATE TABLE IF NOT EXISTS lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER, title TEXT, content TEXT, order_index INTEGER)');
    db.run('CREATE TABLE IF NOT EXISTS lesson_progress (user_id INTEGER, lesson_id INTEGER, completed INTEGER, completed_at TEXT, PRIMARY KEY(user_id, lesson_id))');
    db.run('CREATE TABLE IF NOT EXISTS quizzes (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER, title TEXT)');
    db.run('CREATE TABLE IF NOT EXISTS quiz_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER, prompt TEXT, options TEXT, correct_option INTEGER)');
    db.run('CREATE TABLE IF NOT EXISTS quiz_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER, user_id INTEGER, answers TEXT, score INTEGER, created_at TEXT)');
    db.run('CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER, title TEXT, description TEXT)');
    db.run('CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER, user_id INTEGER, content TEXT, feedback TEXT, created_at TEXT)');
    db.get('SELECT COUNT(*) as c FROM users WHERE email = ?', ['student@test.com'], (err, row) => {
      if (!row || row.c === 0) {
        const hash = bcrypt.hashSync('123456', 10);
        db.run('INSERT INTO users (name,email,passwordHash,role) VALUES (?,?,?,?)', ['Student Demo', 'student@test.com', hash, 'student']);
      }
    });
    db.get('SELECT COUNT(*) as c FROM users WHERE email = ?', ['instructor@test.com'], (err, row) => {
      if (!row || row.c === 0) {
        const hash = bcrypt.hashSync('123456', 10);
        db.run('INSERT INTO users (name,email,passwordHash,role) VALUES (?,?,?,?)', ['Instructor Demo', 'instructor@test.com', hash, 'instructor']);
      }
    });
    db.get('SELECT COUNT(*) as c FROM users WHERE email = ?', ['admin@test.com'], (err, row) => {
      if (!row || row.c === 0) {
        const hash = bcrypt.hashSync('123456', 10);
        db.run('INSERT INTO users (name,email,passwordHash,role) VALUES (?,?,?,?)', ['Admin Demo', 'admin@test.com', hash, 'admin']);
      }
    });
    db.get('SELECT COUNT(*) as c FROM lessons', (err, row) => {
      const seed = !row || row.c === 0;
      if (seed) {
        const stmt = db.prepare('INSERT INTO lessons (course_id,title,content,order_index) VALUES (?,?,?,?)');
        const seedLessons = [
          [1, 'Intro to the Web', 'How the web works, HTTP, browsers', 1],
          [1, 'HTML Essentials', 'Semantic HTML, structure and accessibility basics', 2],
          [1, 'CSS Basics', 'Selectors, layout, responsive design', 3],
          [1, 'JavaScript Basics', 'Variables, functions, DOM', 4],
          [1, 'Project: Landing Page', 'Build a responsive landing page', 5],
          [2, 'ES6+ Features', 'Let/const, arrow functions, modules', 1],
          [2, 'Async Patterns', 'Promises, async/await, error handling', 2],
          [2, 'DOM Mastery', 'DOM APIs, events, performance', 3],
          [2, 'Tooling', 'Bundlers, linters, formatters', 4]
        ];
        for (const l of seedLessons) stmt.run(l);
        stmt.finalize();
      }
    });
    db.all('PRAGMA table_info(enrollments)', [], (err, cols) => {
      if (!err) {
        const hasCourseId = Array.isArray(cols) && cols.some(c => c.name === 'course_id');
        if (!hasCourseId) { db.run('ALTER TABLE enrollments ADD COLUMN course_id INTEGER'); }
      }
    });
    db.all('PRAGMA table_info(courses)', [], (err, cols) => {
      if (!err) {
        const hasImage = Array.isArray(cols) && cols.some(c => c.name === 'image_url');
        if (!hasImage) { db.run('ALTER TABLE courses ADD COLUMN image_url TEXT'); }
      }
    });
    db.get('SELECT COUNT(*) as c FROM courses', (err, row) => {
      const seed = !row || row.c === 0;
      if (seed) {
        const stmt = db.prepare('INSERT INTO courses (id,title,instructor,category,level,duration,description,image_url) VALUES (?,?,?,?,?,?,?,?)');
        const seedCourses = [
          [1, 'Web Development Mastery', 'John Smith', 'Web Dev', 'Beginner', '12h', 'Build modern responsive websites using HTML, CSS, and JS.', 'https://upload.wikimedia.org/wikipedia/commons/6/61/HTML5_logo_and_wordmark.svg'],
          [2, 'JavaScript Superpowers', 'Sarah Johnson', 'Programming', 'Intermediate', '10h', 'Master ES6+, async patterns, and practical DOM workflows.', 'https://share.google/images/Q4dZtlgWHmiK8w6Of'],
          [3, 'Python Domination', 'Mike Davis', 'Coding', 'Beginner', '14h', 'From basics to OOP and packages with hands-on labs.', 'https://upload.wikimedia.org/wikipedia/commons/f/f8/Python_logo_and_wordmark.svg'],
          [4, 'Data Science Revolution', 'Emily Chen', 'Data Science', 'Advanced', '16h', 'Statistics, pandas, visualization, and ML foundations.', 'https://upload.wikimedia.org/wikipedia/commons/1/12/Chart_bar_black.svg'],
          [5, 'UI/UX Design Legends', 'Alex Rivera', 'Design', 'Beginner', '8h', 'Human-centered design, wireframes, and prototyping best practices.', 'https://upload.wikimedia.org/wikipedia/commons/3/33/Figma-logo.svg'],
          [6, 'MongoDB Database Beast', 'Robert Kumar', 'Database', 'Intermediate', '9h', 'Schemas, queries, indexes, and performance tuning.', 'https://upload.wikimedia.org/wikipedia/commons/9/93/MongoDB_Logo.svg']
        ];
        for (const c of seedCourses) stmt.run(c);
        stmt.finalize();
      }
    });
    const moreCourses = [
      { id: 7, title: 'React Essentials', instructor: 'Nina Patel', category: 'Web Dev', level: 'Intermediate', duration: '11h', description: 'Components, hooks, and state management fundamentals.', image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/a7/React-icon.svg' },
      { id: 8, title: 'TypeScript for Pros', instructor: 'David Lee', category: 'Programming', level: 'Intermediate', duration: '9h', description: 'Types, generics, interfaces, and integrating with JS projects.', image_url: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/Typescript_logo_2020.svg' },
      { id: 9, title: 'Node.js API Design', instructor: 'Priya Sharma', category: 'Backend', level: 'Intermediate', duration: '12h', description: 'REST patterns, auth, validation, and performance.', image_url: 'https://upload.wikimedia.org/wikipedia/commons/d/d9/Node.js_logo.svg' },
      { id: 10, title: 'SQL & Data Modeling', instructor: 'Luis Garcia', category: 'Database', level: 'Beginner', duration: '10h', description: 'Relational fundamentals, SQL queries, and schema design.', image_url: '' },
      { id: 12, title: 'DevOps Basics', instructor: 'Tom Nguyen', category: 'DevOps', level: 'Beginner', duration: '7h', description: 'CI/CD, pipelines, environments, and observability.', image_url: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Git_icon.svg' }
    ];
    moreCourses.forEach((c) => {
      db.get('SELECT id FROM courses WHERE title = ?', [c.title], (e, row2) => {
        const cid = row2 && row2.id ? row2.id : c.id;
        if (!row2) {
          db.run('INSERT INTO courses (title,instructor,category,level,duration,description,image_url) VALUES (?,?,?,?,?,?,?)', [c.title, c.instructor, c.category, c.level, c.duration, c.description, c.image_url || '']);
        } else if (c.image_url) {
          db.run('UPDATE courses SET image_url = ? WHERE id = ?', [c.image_url, cid]);
        }
        db.get('SELECT COUNT(*) as c FROM lessons WHERE course_id = ?', [cid], (e2, r2) => {
          const needSeed = !r2 || r2.c === 0;
          if (needSeed) {
            const L = db.prepare('INSERT INTO lessons (course_id,title,content,order_index) VALUES (?,?,?,?)');
            if (cid === 7) {
              L.run([cid, 'Intro to React', 'JSX, components, props', 1]);
              L.run([cid, 'Hooks 101', 'useState, useEffect basics', 2]);
              L.run([cid, 'State Management', 'Lifting state, context', 3]);
            } else if (cid === 9) {
              L.run([cid, 'Express Basics', 'Routing and middleware', 1]);
              L.run([cid, 'Authentication', 'JWT, sessions, security', 2]);
              L.run([cid, 'Validation & Errors', 'Input validation and error handling', 3]);
            } else {
              L.run([cid, 'Course Overview', 'What you will learn', 1]);
              L.run([cid, 'First Steps', 'Setup and hello world', 2]);
            }
            L.finalize();
          }
        });
      });
    });
    const setImages = [
      ['Web Development Mastery','https://upload.wikimedia.org/wikipedia/commons/6/61/HTML5_logo_and_wordmark.svg'],
      ['JavaScript Superpowers','https://upload.wikimedia.org/wikipedia/commons/6/6a/JavaScript-logo.png'],
      ['Python Domination','https://upload.wikimedia.org/wikipedia/commons/f/f8/Python_logo_and_wordmark.svg'],
      ['Data Science Revolution','https://upload.wikimedia.org/wikipedia/commons/1/12/Chart_bar_black.svg'],
      ['UI/UX Design Legends','https://upload.wikimedia.org/wikipedia/commons/3/33/Figma-logo.svg'],
      ['MongoDB Database Beast','https://upload.wikimedia.org/wikipedia/commons/9/93/MongoDB_Logo.svg']
    ];
    setImages.forEach(([title,url]) => { db.run("UPDATE courses SET image_url = ? WHERE title = ? AND (image_url IS NULL OR image_url = '')", [url, title]); });
    db.run("UPDATE courses SET image_url = '/images/sql.jpg' WHERE title = 'SQL & Data Modeling'");
    db.run("UPDATE courses SET image_url = 'https://upload.wikimedia.org/wikipedia/commons/9/93/MongoDB_Logo.svg' WHERE title LIKE '%MongoDB%'");
    const toRemove = [16, 17];
    db.all('SELECT id FROM quizzes WHERE course_id IN (' + toRemove.join(',') + ')', [], (err, qs) => {
      if (!err) { (qs || []).forEach(q => { db.run('DELETE FROM quiz_questions WHERE quiz_id = ?', [q.id]); }); db.run('DELETE FROM quizzes WHERE course_id IN (' + toRemove.join(',') + ')'); }
    });
    db.all('SELECT id FROM assignments WHERE course_id IN (' + toRemove.join(',') + ')', [], (err, as) => {
      if (!err) { (as || []).forEach(a => { db.run('DELETE FROM submissions WHERE assignment_id = ?', [a.id]); }); db.run('DELETE FROM assignments WHERE course_id IN (' + toRemove.join(',') + ')'); }
    });
    db.run('DELETE FROM lesson_progress WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id IN (' + toRemove.join(',') + '))');
    db.run('DELETE FROM lessons WHERE course_id IN (' + toRemove.join(',') + ')');
    db.run('DELETE FROM enrollments WHERE course_id IN (' + toRemove.join(',') + ')');
    db.run('DELETE FROM courses WHERE id IN (' + toRemove.join(',') + ')');
    db.run("UPDATE courses SET image_url = 'https://share.google/images/Q4dZtlgWHmiK8w6Of' WHERE title = 'JavaScript Superpowers'");
    const toRemove2 = [18,19];
    db.all('SELECT id FROM quizzes WHERE course_id IN (' + toRemove2.join(',') + ')', [], (err, qs) => {
      if (!err) { (qs || []).forEach(q => { db.run('DELETE FROM quiz_questions WHERE quiz_id = ?', [q.id]); }); db.run('DELETE FROM quizzes WHERE course_id IN (' + toRemove2.join(',') + ')'); }
    });
    db.all('SELECT id FROM assignments WHERE course_id IN (' + toRemove2.join(',') + ')', [], (err, as) => {
      if (!err) { (as || []).forEach(a => { db.run('DELETE FROM submissions WHERE assignment_id = ?', [a.id]); }); db.run('DELETE FROM assignments WHERE course_id IN (' + toRemove2.join(',') + ')'); }
    });
    db.run('DELETE FROM lesson_progress WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id IN (' + toRemove2.join(',') + '))');
    db.run('DELETE FROM lessons WHERE course_id IN (' + toRemove2.join(',') + ')');
    db.run('DELETE FROM enrollments WHERE course_id IN (' + toRemove2.join(',') + ')');
    db.run('DELETE FROM courses WHERE id IN (' + toRemove2.join(',') + ')');
    db.get('SELECT id FROM courses WHERE title = ?', ['Cloud Fundamentals'], (errCF, rowCF) => {
      if (!errCF && rowCF && rowCF.id) {
        const cid = rowCF.id;
        db.run('DELETE FROM lesson_progress WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)', [cid]);
        db.run('DELETE FROM lessons WHERE course_id = ?', [cid]);
        db.run('DELETE FROM enrollments WHERE course_id = ?', [cid]);
        db.all('SELECT id FROM quizzes WHERE course_id = ?', [cid], (e1, qs) => {
          (qs || []).forEach(q => db.run('DELETE FROM quiz_questions WHERE quiz_id = ?', [q.id]));
          db.run('DELETE FROM quizzes WHERE course_id = ?', [cid]);
        });
        db.all('SELECT id FROM assignments WHERE course_id = ?', [cid], (e2, as) => {
          (as || []).forEach(a => db.run('DELETE FROM submissions WHERE assignment_id = ?', [a.id]));
          db.run('DELETE FROM assignments WHERE course_id = ?', [cid]);
        });
        db.run('DELETE FROM courses WHERE id = ?', [cid]);
      }
    });
    db.get('SELECT COUNT(*) as c FROM quizzes', (err, row) => {
      const seed = !row || row.c === 0;
      if (seed) {
        const qstmt = db.prepare('INSERT INTO quizzes (id,course_id,title) VALUES (?,?,?)');
        const qsstmt = db.prepare('INSERT INTO quiz_questions (quiz_id,prompt,options,correct_option) VALUES (?,?,?,?)');
        qstmt.run([1, 1, 'Basics Check']);
        qsstmt.run([1, 'HTML stands for?', JSON.stringify(['Hyperlinks and Text Markup Language','Hyper Text Markup Language','Home Tool Markup Language']), 1]);
        qsstmt.run([1, 'CSS is used for?', JSON.stringify(['Styling','Database','Networking']), 0]);
        qstmt.run([2, 2, 'JavaScript Core']);
        qsstmt.run([2, 'let vs var: let is?', JSON.stringify(['Function-scoped','Block-scoped','Global only']), 1]);
        qstmt.finalize();
        qsstmt.finalize();
      }
    });
    db.get('SELECT COUNT(*) as c FROM assignments', (err, row) => {
      const seed = !row || row.c === 0;
      if (seed) {
        const astmt = db.prepare('INSERT INTO assignments (id,course_id,title,description) VALUES (?,?,?,?)');
        astmt.run([1, 1, 'Build a Landing Page', 'Create a simple responsive landing page with HTML and CSS.']);
        astmt.run([2, 2, 'Write Async Functions', 'Implement two async functions using fetch and handle errors.']);
        astmt.finalize();
      }
    });
  });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') {
    try {
      const payload = jwt.verify(parts[1], JWT_SECRET);
      req.user = payload;
      return next();
    } catch (e) {}
  }
  res.status(401).json({ error: 'unauthorized' });
}

function requireRole(role) {
  return function(req, res, next) {
    const ok = Array.isArray(role) ? role.includes(req.user && req.user.role) : (req.user && req.user.role === role);
    if (ok) return next();
    res.status(403).json({ error: 'forbidden' });
  }
}

app.post('/api/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'missing_fields' });
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase());
  if (!emailOk) return res.status(400).json({ error: 'bad_email' });
  if (String(password).length < 6) return res.status(400).json({ error: 'weak_password' });
  if (!['student','instructor','admin'].includes(String(role))) return res.status(400).json({ error: 'bad_role' });
  const hash = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users (name,email,passwordHash,role) VALUES (?,?,?,?)', [name, email.toLowerCase(), hash, role], function(err) {
    if (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'email_exists' });
      return res.status(500).json({ error: 'server_error' });
    }
    res.json({ ok: true });
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  // simple rate limit by IP
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString();
  global.__rate = global.__rate || {};
  const rec = global.__rate[ip] || { count: 0, ts: Date.now() };
  const now = Date.now();
  if (now - rec.ts > 5 * 60 * 1000) { rec.count = 0; rec.ts = now; }
  rec.count += 1;
  global.__rate[ip] = rec;
  if (rec.count > 50) return res.status(429).json({ error: 'too_many_attempts' });
  db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = bcrypt.compareSync(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
  });
});

// Basic health check
app.get('/api/health', (req, res) => { res.json({ ok: true, time: new Date().toISOString() }); });

app.get('/api/me', auth, (req, res) => {
  db.get('SELECT id,name,email,role FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'not_found' });
    res.json({ user });
  });
});

app.patch('/api/me', auth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'missing_name' });
  db.run('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id], function(err){
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ ok: true });
  });
});

app.get('/api/courses', (req, res) => {
  db.all('SELECT id,title,instructor,category,level,duration,description,image_url FROM courses ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ courses: rows });
  });
});

app.get('/api/admin/courses', auth, requireRole('admin'), (req, res) => {
  db.all('SELECT id,title,instructor,category,level,duration,description,image_url FROM courses ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ courses: rows });
  });
});

app.patch('/api/courses/:id', auth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const allowed = ['title','instructor','category','level','duration','description','image_url'];
  const data = {};
  allowed.forEach(k => { if (typeof req.body[k] !== 'undefined') data[k] = req.body[k]; });
  const keys = Object.keys(data);
  if (keys.length === 0) return res.status(400).json({ error: 'no_fields' });
  const set = keys.map(k => k + ' = ?').join(', ');
  const vals = keys.map(k => data[k]);
  vals.push(id);
  db.run('UPDATE courses SET ' + set + ' WHERE id = ?', vals, function(err){
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ ok: true, changes: this.changes });
  });
});

app.get('/api/courses/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.get('SELECT id,title,instructor,category,level,duration,description,image_url FROM courses WHERE id = ?', [id], (err, course) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    if (!course) return res.status(404).json({ error: 'not_found' });
    res.json({ course });
  });
});

app.get('/api/courses/:id/lessons', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.all('SELECT id,course_id,title,content,order_index FROM lessons WHERE course_id = ? ORDER BY order_index ASC', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ lessons: rows });
  });
});

app.get('/api/courses/:id/progress', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.all('SELECT l.id, COALESCE(lp.completed, 0) as completed FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ? WHERE l.course_id = ?', [req.user.id, id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    const total = rows.length;
    const done = rows.filter(r => r.completed === 1).length;
    res.json({ total, completed: done, percent: total ? Math.round((done/total)*100) : 0 });
  });
});

app.post('/api/lessons/:id/progress', auth, (req, res) => {
  const lessonId = parseInt(req.params.id, 10);
  const { completed } = req.body;
  const flag = completed ? 1 : 0;
  const ts = completed ? new Date().toISOString() : null;
  db.run('INSERT INTO lesson_progress (user_id, lesson_id, completed, completed_at) VALUES (?,?,?,?) ON CONFLICT(user_id, lesson_id) DO UPDATE SET completed = excluded.completed, completed_at = excluded.completed_at', [req.user.id, lessonId, flag, ts], function(err){
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ ok: true });
  });
});

app.get('/api/courses/:id/lesson-progress', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.all('SELECT l.id, COALESCE(lp.completed, 0) as completed FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ? WHERE l.course_id = ?', [req.user.id, id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ items: rows });
  });
});

app.get('/api/courses/:id/next-incomplete', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.all('SELECT l.id, l.order_index, COALESCE(lp.completed, 0) as completed FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ? WHERE l.course_id = ? ORDER BY l.order_index ASC', [req.user.id, id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    const next = rows.find(r => r.completed === 0);
    res.json({ order_index: next ? next.order_index : null });
  });
});

app.get('/api/courses/:id/quizzes', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.all('SELECT id, course_id, title FROM quizzes WHERE course_id = ?', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ quizzes: rows });
  });
});

app.get('/api/quizzes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.get('SELECT id, course_id, title FROM quizzes WHERE id = ?', [id], (err, quiz) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    if (!quiz) return res.status(404).json({ error: 'not_found' });
    db.all('SELECT id, prompt, options FROM quiz_questions WHERE quiz_id = ?', [id], (err2, qs) => {
      if (err2) return res.status(500).json({ error: 'server_error' });
      const questions = (qs || []).map(q => ({ id: q.id, prompt: q.prompt, options: JSON.parse(q.options || '[]') }));
      res.json({ quiz: { id: quiz.id, course_id: quiz.course_id, title: quiz.title, questions } });
    });
  });
});

app.post('/api/quizzes/:id/attempt', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const answers = req.body.answers || {};
  db.all('SELECT id, correct_option FROM quiz_questions WHERE quiz_id = ?', [id], (err, qs) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    let score = 0;
    (qs || []).forEach(q => { if (String(answers[q.id]) === String(q.correct_option)) score += 1; });
    const created = new Date().toISOString();
    db.run('INSERT INTO quiz_attempts (quiz_id,user_id,answers,score,created_at) VALUES (?,?,?,?,?)', [id, req.user.id, JSON.stringify(answers), score, created], function(err2){
      if (err2) return res.status(500).json({ error: 'server_error' });
      res.json({ score, total: (qs || []).length });
    });
  });
});

app.get('/api/courses/:id/assignments', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.all('SELECT id, course_id, title, description FROM assignments WHERE course_id = ?', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ assignments: rows });
  });
});

app.post('/api/assignments/:id/submit', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'missing_content' });
  const created = new Date().toISOString();
  db.run('INSERT INTO submissions (assignment_id,user_id,content,feedback,created_at) VALUES (?,?,?,?,?)', [id, req.user.id, content, '', created], function(err){
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ ok: true, id: this.lastID });
  });
});

app.get('/api/assignments/:id/submission', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.get('SELECT id, content, feedback, created_at FROM submissions WHERE assignment_id = ? AND user_id = ? ORDER BY id DESC', [id, req.user.id], (err, sub) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ submission: sub || null });
  });
});

app.post('/api/submissions/:id/feedback', auth, requireRole(['instructor','admin']), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const feedback = String(req.body.feedback || '');
  db.run('UPDATE submissions SET feedback = ? WHERE id = ?', [feedback, id], function(err){
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ ok: true });
  });
});

app.get('/api/enrollments', auth, (req, res) => {
  db.all('SELECT e.id,e.title,e.instructor,e.category,e.course_id,e.created_at,c.image_url FROM enrollments e LEFT JOIN courses c ON c.id = e.course_id WHERE e.user_id = ? ORDER BY e.id DESC', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ enrollments: rows });
  });
});

app.post('/api/enroll', auth, (req, res) => {
  const { title, instructor, category, course_id } = req.body;
  if (!title) return res.status(400).json({ error: 'missing_title' });
  const created = new Date().toISOString();
  db.run('INSERT INTO enrollments (user_id,title,instructor,category,course_id,created_at) VALUES (?,?,?,?,?,?)', [req.user.id, title, instructor || '', category || '', course_id || null, created], function(err) {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ id: this.lastID });
  });
});

app.delete('/api/enrollments/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'bad_id' });
  db.run('DELETE FROM enrollments WHERE id = ? AND user_id = ?', [id, req.user.id], function(err) {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ ok: true });
  });
});

app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server listening on http://localhost:' + PORT);
});