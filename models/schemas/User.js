import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't return password by default
    },
    picture: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    googleId: {
      type: String,
      default: null,
      index: true,  // Index for faster lookups, but NOT unique
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  // Only hash if password is new or modified
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcryptjs.genSalt(10);
    this.password = await bcryptjs.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) {
    return false;
  }
  return await bcryptjs.compare(enteredPassword, this.password);
};

// Method to get user without password
userSchema.methods.toJSON = function () {
  const { password, ...user } = this.toObject();
  return user;
};

// Prevent duplicate email on update
userSchema.pre('findByIdAndUpdate', async function (next) {
  const update = this.getUpdate();
  
  if (update.email) {
    const existingUser = await mongoose.model('User').findOne({
      email: update.email,
      _id: { $ne: this.getFilter()._id },
    });

    if (existingUser) {
      throw new Error('Email already in use');
    }
  }

  next();
});

const User = mongoose.model('User', userSchema);

export default User;
