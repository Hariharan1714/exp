
//User.js

const { Model, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');

class User extends Model {
  // Define associations if needed
  static associate(models) {
    this.hasMany(models.Expense);
  }

  // Custom method to compare passwords
  async comparePassword(password) {
    return bcrypt.compare(password, this.password);
  }
}

module.exports = (sequelize) => {
  User.init({
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    isPremium: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    resetPasswordToken: {
      type: DataTypes.STRING,
  },
  resetPasswordExpires: {
      type: DataTypes.DATE,
  },

  
  }, {
    sequelize,
    modelName: 'User',
  });

  

  return User;
};
