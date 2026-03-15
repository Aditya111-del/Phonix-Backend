# phonix Backend API

Production-ready backend for the phonix algorithmic trading platform.

## Features

✅ **Authentication**
- Email/Password Registration & Login
- Google OAuth 2.0 Integration
- JWT Token-based Authorization
- Bcryptjs Password Hashing
- MongoDB Persistence

✅ **Bot Marketplace**
- List available trading bots
- Download bots
- Track download statistics

✅ **Admin Management**
- Upload new bots
- Manage bot status
- Delete bots
- Admin-only endpoints

✅ **Security**
- Role-based Access Control (User, Admin)
- Password hashing with bcryptjs
- CORS protection
- JWT middleware

## Quick Start

### Prerequisites
- Node.js v14+
- MongoDB (local or Atlas)
- npm v6+

### Installation

```bash
npm install
```

### Configuration

Create `.env` file (copy from `.env.example`):

```env
PORT=5000
NODE_ENV=development
JWT_SECRET=your-secret-key
MONGODB_URI=mongodb://localhost:27017/phonix
FRONTEND_URL=http://localhost:5173
```

### Running

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run prod
```

### Expected Output

```
✓ MongoDB connected: mongodb://localhost:27017/phonix
✅ Server running on http://localhost:5000
```

## API Endpoints

All API endpoints are prefixed with `/api/`

### Authentication (`/auth`)
- `POST /register` - Create new account
- `POST /login` - Login with email/password
- `POST /google` - Google OAuth login

### Bots (`/bots`)
- `GET /` - List all bots
- `GET /:id` - Get bot details
- `POST /:id/download` - Download bot

### Admin (`/admin`)
- `GET /` - List all bots (admin only)
- `POST /upload` - Upload new bot
- `PATCH /:id/status` - Update bot status
- `DELETE /:id` - Delete bot

## Database Schema

### User
```
{
  _id: ObjectId
  name: String (required)
  email: String (unique, required)
  password: String (hashed)
  picture: String (optional)
  role: String (user | admin)
  isActive: Boolean
  createdAt: Date
  updatedAt: Date
}
```

## Project Structure

```
backend/
├── db/
│   └── connection.js      # MongoDB connection
├── models/
│   ├── schemas/
│   │   └── User.js        # Mongoose User schema
│   ├── Bot.js             # Bot model
│   └── User.js            # Legacy mock model
├── routes/
│   ├── auth.js            # Auth endpoints
│   ├── bots.js            # Bot endpoints
│   └── admin.js           # Admin endpoints
├── middleware/
│   └── auth.js            # JWT middleware
├── uploads/               # Uploaded files
├── server.js              # Express setup
├── .env                   # Configuration
└── package.json           # Dependencies
```

## Complete Setup Guide

For comprehensive setup instructions including MongoDB installation, testing, and troubleshooting, see:

👉 **[AUTHENTICATION_SETUP.md](../AUTHENTICATION_SETUP.md)**

## Key Technologies

- **Express.js** - Web framework
- **MongoDB & Mongoose** - Database
- **JWT** - Authentication
- **bcryptjs** - Password hashing
- **Multer** - File uploads
- **CORS** - Cross-origin requests
- **Nodemon** - Development auto-reload

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment | `development` |
| `JWT_SECRET` | JWT signing key | `secret-key-123` |
| `MONGODB_URI` | MongoDB connection | `mongodb://localhost:27017/phonix` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:5173` |

## Troubleshooting

**MongoDB connection failed:**
- Ensure MongoDB is running
- Check `MONGODB_URI` is correct
- For Atlas, verify IP whitelist

**CORS errors:**
- Check CORS origins in `server.js`
- Ensure backend and frontend URLs match config

**Authentication errors:**
- Verify JWT_SECRET is set
- Check user exists in database
- Ensure password is correct

## API Response Format

All responses follow this format:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error message"
}
```

---

**For detailed setup and deployment instructions, see [AUTHENTICATION_SETUP.md](../AUTHENTICATION_SETUP.md)**

```
PORT=5000
JWT_SECRET=your-secret-key-here
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

### 3. Start the Server

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server will be available at `http://localhost:5000`

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/google` - Google OAuth login

### Bots (Public)

- `GET /api/bots` - List all active bots
- `GET /api/bots/:id` - Get specific bot
- `POST /api/bots/:id/download` - Download bot (requires auth)

### Admin

- `GET /api/admin` - List all bots (admin only)
- `POST /api/admin/upload` - Upload new bot (admin only)
- `PATCH /api/admin/:id/status` - Update bot status (admin only)
- `DELETE /api/admin/:id` - Delete bot (admin only)

## Default Admin Credentials

```
Email: admin@phonix.com
Password: admin123
```

⚠️ Change these in production!

## API Examples

### Register

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }'
```

### Login

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Download Bot

```bash
curl -X POST http://localhost:5000/api/bots/bot-1/download \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Upload Bot (Admin)

```bash
curl -X POST http://localhost:5000/api/admin/upload \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -F "file=@bot-file.zip" \
  -F "name=My Bot" \
  -F "description=Bot description" \
  -F "type=Momentum" \
  -F "version=1.0.0"
```

## Data Flow

### User Journey

1. User registers/logs in → Receives JWT token
2. Token stored in localStorage
3. User browses available bots
4. User downloads bot → Download count incremented
5. User receives download link

### Admin Journey

1. Admin logs in with admin credentials
2. Admin uploads bot file with details
3. Bot status set to "pending"
4. Admin can activate/deactivate bots
5. Bots become available for users

## Database Models

### User
- id: string
- email: string
- password: string (hashed in production)
- name: string
- role: 'admin' | 'user'
- picture?: string
- createdAt: Date

### Bot
- id: string
- name: string
- description: string
- version: string
- type: 'Momentum' | 'Mean Reversion' | 'Trend Following' | 'Arbitrage'
- fileName: string
- uploadedBy: string (User ID)
- uploadedAt: Date
- status: 'active' | 'pending' | 'inactive'
- downloads: number
- rating: number

## Security Considerations

1. JWT tokens expire after 7 days
2. Admin routes protected with middleware
3. File uploads validated by type and size
4. CORS configured for frontend origin only
5. Passwords should be hashed (implement bcryptjs in production)

## Future Enhancements

- [ ] MongoDB integration
- [ ] Password hashing with bcryptjs
- [ ] Email verification
- [ ] Bot ratings and reviews
- [ ] User download history
- [ ] AWS S3 integration for file storage
- [ ] Rate limiting
- [ ] Logging and monitoring
- [ ] Docker containerization

## License

MIT
