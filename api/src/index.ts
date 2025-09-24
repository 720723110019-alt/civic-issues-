import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

type Role = 'User' | 'Admin';

type User = { id: string; email?: string; aadhaar?: string; password: string; role: Role; language?: string };
type Media = { type: 'photo' | 'video' | 'audio'; data: string };
type IssueStatus = 'Reported' | 'Verified' | 'Assigned' | 'Resolved' | 'Spam';
type Priority = 'Low' | 'Medium' | 'High';
type Issue = {
  id: string;
  userId: string;
  category: string;
  description: string;
  priority: Priority;
  department?: string;
  emergency: boolean;
  status: IssueStatus;
  location?: { lat: number; lng: number } | null;
  media?: Media | null;
  voice?: Media | null;
  createdAt: number;
  updatedAt: number;
};

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(morgan('dev'));

// In-memory stores for prototype
const users: Record<string, User> = {};
const issues: Record<string, Issue> = {};

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Auth endpoints (prototype only)
app.post('/auth/signup', (req, res) => {
  const { email, aadhaar, password, role, language } = req.body as Partial<User>;
  if ((!email && !aadhaar) || !password || !role) {
    return res.status(400).json({ error: 'email or aadhaar, password and role are required' });
  }
  const id = Date.now().toString(36);
  const user: User = { id, email, aadhaar, password, role, language } as User;
  users[id] = user;
  return res.json({ token: `dev-${id}`, user: { id, role, email, aadhaar, language } });
});

app.post('/auth/login', (req, res) => {
  const { identifier, password } = req.body as { identifier: string; password: string };
  const found = Object.values(users).find(
    (u) => (u.email === identifier || u.aadhaar === identifier) && u.password === password
  );
  if (!found) return res.status(401).json({ error: 'Invalid credentials' });
  return res.json({ token: `dev-${found.id}`, user: { id: found.id, role: found.role, email: found.email, aadhaar: found.aadhaar, language: found.language } });
});

// Naive media verification (placeholder for CNN)
function verifyMediaHeuristic(media?: Media | null): { isGenuine: boolean; reason?: string } {
  if (!media) return { isGenuine: false, reason: 'No media' };
  try {
    const base64 = media.data.split(',')[1] ?? '';
    const sizeBytes = Math.ceil((base64.length * 3) / 4);
    if (media.type === 'photo' && sizeBytes < 10_000) {
      return { isGenuine: false, reason: 'Image too small' };
    }
    return { isGenuine: true };
  } catch {
    return { isGenuine: false, reason: 'Invalid media data' };
  }
}

app.post('/verify', (req, res) => {
  const { media } = req.body as { media: Media };
  const result = verifyMediaHeuristic(media);
  return res.json({ ...result, category: 'Other' });
});

// Issues
app.get('/issues', (req, res) => {
  const { category, status, priority, from, to } = req.query as Record<string, string | undefined>;
  let list = Object.values(issues);
  if (category) list = list.filter(i => i.category === category);
  if (status) list = list.filter(i => i.status === status);
  if (priority) list = list.filter(i => i.priority === priority);
  const fromTs = from ? Number(from) : undefined;
  const toTs = to ? Number(to) : undefined;
  if (fromTs) list = list.filter(i => i.createdAt >= fromTs);
  if (toTs) list = list.filter(i => i.createdAt <= toTs);
  res.json({ issues: list });
});

app.post('/issues', (req, res) => {
  const { token } = req.headers;
  if (!token || typeof token !== 'string' || !token.startsWith('dev-'))
    return res.status(401).json({ error: 'Unauthorized' });
  const userId = token.slice(4);
  const { description, category, priority, emergency, location, media, voice, department } = req.body as Partial<Issue> & { priority: Priority };
  if (!description || !priority) return res.status(400).json({ error: 'description and priority are required' });
  const now = Date.now();
  const id = now.toString(36);
  const { isGenuine } = verifyMediaHeuristic(media ?? null);
  const status: IssueStatus = isGenuine ? 'Reported' : 'Spam';
  const issue: Issue = {
    id,
    userId,
    category: category ?? 'Other',
    description,
    priority,
    emergency: Boolean(emergency),
    status,
    location: location ?? null,
    media: media ?? null,
    voice: voice ?? null,
    department,
    createdAt: now,
    updatedAt: now,
  };
  issues[id] = issue;
  res.json({ issue });
});

app.patch('/issues/:id', (req, res) => {
  const id = req.params.id;
  const existing = issues[id];
  if (!existing) return res.status(404).json({ error: 'Issue not found' });
  const { status, department, priority } = req.body as Partial<Issue>;
  if (status) existing.status = status as IssueStatus;
  if (department !== undefined) existing.department = department;
  if (priority) existing.priority = priority as Priority;
  existing.updatedAt = Date.now();
  res.json({ issue: existing });
});

// Simple weekly escalation (prototype)
setInterval(() => {
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  Object.values(issues).forEach(issue => {
    if (issue.status !== 'Resolved' && now - issue.createdAt > oneWeekMs) {
      issue.status = 'Assigned';
      issue.department = issue.department || 'Commissioner';
      issue.updatedAt = now;
    }
  });
}, 60 * 1000);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${port}`);
});

