// Mock database for bots - starts empty, bots are uploaded via admin dashboard
let bots = [];

export const BotModel = {
  findAll: (filters = {}) => {
    let result = bots;
    if (filters.status) {
      result = result.filter(b => b.status === filters.status);
    }
    if (filters.type) {
      result = result.filter(b => b.type === filters.type);
    }
    return result;
  },

  findById: (id) => bots.find(b => b.id === id),

  create: (botData) => {
    const newBot = {
      id: `bot-${Date.now()}`,
      ...botData,
      uploadedAt: new Date(),
      downloads: 0,
      rating: 0,
      status: 'pending',
    };
    bots.push(newBot);
    return newBot;
  },

  update: (id, updates) => {
    const index = bots.findIndex(b => b.id === id);
    if (index !== -1) {
      bots[index] = { ...bots[index], ...updates };
      return bots[index];
    }
    return null;
  },

  delete: (id) => {
    const index = bots.findIndex(b => b.id === id);
    if (index !== -1) {
      bots.splice(index, 1);
      return true;
    }
    return false;
  },

  incrementDownloads: (id) => {
    const bot = bots.find(b => b.id === id);
    if (bot) {
      bot.downloads += 1;
      return bot;
    }
    return null;
  },
};
