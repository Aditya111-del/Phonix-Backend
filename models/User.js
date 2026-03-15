// Mock database for users
const users = [
  {
    id: 'admin-1',
    email: 'admin@phonix.com',
    password: 'admin123', // In production, this would be hashed
    name: 'Admin User',
    role: 'admin',
    createdAt: new Date(),
  },
  {
    id: 'user-1',
    email: 'user@example.com',
    password: 'user123',
    name: 'Test User',
    role: 'user',
    createdAt: new Date(),
  },
];

;

export const UserModel = {
  findByEmail: (email) => users.find(u => u.email === email),

  findById: (id) => users.find(u => u.id === id),

  create: (userData) => {
    const newUser = {
      id: `user-${Date.now()}`,
      ...userData,
      createdAt: new Date(),
    };
    users.push(newUser);
    return newUser;
  },

  authenticate: (email, password) => {
    const user = users.find(u => u.email === email && u.password === password);
    if (user) {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    }
    return null;
  },
};
