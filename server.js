const express = require('express');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const Razorpay = require('razorpay');
const jwt = require('jsonwebtoken'); // Import JWT
const crypto = require('crypto');
const nodemailer = require('nodemailer');


const app = express();
const PORT = process.env.PORT || 3001;
const secretKey = 'your_secret_key'; // Replace with your own secret key

const sequelize = new Sequelize('nodejs', 'admin', 'harrywedshpd', {
  host: 'database-1.c76uskew0vbg.ap-southeast-2.rds.amazonaws.com',
  dialect: 'mysql'
});

const User = require('./models/User')(sequelize, DataTypes);
const Expense = require('./models/Expense')(sequelize, DataTypes);



User.hasMany(Expense);
Expense.belongsTo(User);

const razorpay = new Razorpay({
  key_id: 'rzp_test_oiV0A8uBezexxh',
  key_secret: 'CwTml0HRFzQwsBiLcFTgxwVn'
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).send('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10); // Hash the password
    await User.create({ name, email, password: hashedPassword });

    res.redirect('/login?signupSuccess=true');
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).send('Error creating user');
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.log('User not found:', email);
      return res.status(404).send('User not found');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    console.log('Password match for', email, ':', passwordMatch);

    if (!passwordMatch) {
      return res.status(401).send('Invalid password');
    }

    const token = jwt.sign({ userId: user.id }, secretKey, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).send('Error logging in');
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.status(401).send('Token required');

  jwt.verify(token, secretKey, (err, user) => {
    if (err) return res.status(403).send('Invalid token');
    req.user = user;
    next();
  });
};

app.post('/add-expense', authenticateToken, async (req, res) => {
  const { amount, description, category } = req.body;
  const userId = req.user.userId;

  const transaction = await sequelize.transaction();

  try {
    const user = await User.findByPk(userId);
    if (!user) {
      console.error('User not found for ID:', userId);
      return res.status(404).send('User not found');
    }

    const newExpense = await Expense.create({ amount, description, category, UserId: userId }, { transaction });
    await user.addExpense(newExpense, { transaction });
    await User.increment('totalExpense', { by: amount, where: { id: userId } }, { transaction });
    await transaction.commit();
    res.status(201).send('Expense added successfully!');

  } catch (error) {
    await transaction.rollback();
    console.error('Error adding expense:', error.message);
    res.status(500).send('Error adding expense');
  }
});

app.get('/expenses', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findByPk(userId, {
      attributes: ['isPremium']
    });

    const expenses = await Expense.findAll({ where: { UserId: userId } });
    res.json({ expenses, isPremium: user.isPremium });

  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).send('Error fetching expenses');
  }
});

app.delete('/delete-expense/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const transaction = await sequelize.transaction();
  
  try {
    const expense = await Expense.findByPk(id, { transaction });
    if (!expense) {
      await transaction.rollback();
      return res.status(404).send('Expense not found');
    }

    await User.decrement('totalExpense', { by: expense.amount, where: { id: userId }, transaction });
    await expense.destroy({ transaction });
    await transaction.commit();
    res.status(200).send('Expense deleted successfully');

  } catch (error) {
    await transaction.rollback();
    console.error('Error deleting expense:', error);
    res.status(500).send('Error deleting expense');
  }
});

app.post('/create-order', async (req, res) => {
  console.log('Attempting to create Razorpay order');
  try {
    const options = {
      amount: 2500, // amount in paise (25 INR)
      currency: 'INR',
      receipt: 'receipt_order_74394',
      payment_capture: 0 // 1 for automatic capture, 0 for manual capture
    };

    const order = await razorpay.orders.create(options);
    res.json({ orderId: order.id });
    
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/payment-response', authenticateToken, async (req, res) => {
  const { paymentId, orderId, status } = req.body;

  try {
    if (status === 'success') {
      const userId = req.user.userId;
      const user = await User.findByPk(userId);

      if (user) {
        user.isPremium = true;
        await user.save();

        res.json({ message: 'Payment successful and user updated to premium' });
        console.log('Order purchased successfully!');
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    } else {
      res.status(400).json({ error: 'Payment failed' });
    }
  } catch (error) {
    console.error('Error processing payment response:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/leaderboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findByPk(userId);

    if (!user.isPremium) {
      return res.status(403).send('You do not have access to this feature');
    }

    const leaderboard = await User.findAll({
      attributes: ['name', 'totalExpense'],
      order: [['totalExpense', 'DESC']]
    });

    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).send('Error fetching leaderboard');
  }
});


app.post('/password/forgotpassword', async (req, res) => {
  const { email } = req.body;

  try {
      const user = await User.findOne({ where: { email } });

      if (!user) {
          return res.status(404).send('User not found');
      }

      // Generate a token
      const token = crypto.randomBytes(20).toString('hex');

      // Set token and expiration time on user record
      user.resetPasswordToken = token;
      user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

      await user.save();

      // Set up Nodemailer
      const transporter = nodemailer.createTransport({
          service: 'Gmail',
          auth: {
              user: 'hariharan10420@gmail.com', // replace with your email
              pass: 'yjtawbmlouxozdjz' // replace with your email app password
          }
      });

      const mailOptions = {
          to: user.email,
          from: 'passwordreset@demo.com',
          subject: 'Expense Tracker Password Reset',
          text: `You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n
          Please click on the following link, or paste this into your browser to complete the process:\n\n
          http://${req.headers.host}/reset/${token}\n\n
          If you did not request this, please ignore this email and your password will remain unchanged.\n`
      };

      transporter.sendMail(mailOptions, (err) => {
          if (err) {
              console.error('Error sending email:', err);
              return res.status(500).send('Error sending email');
          }
          res.status(200).send('Password reset link has been sent to your email.');
      });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).send('Error processing password reset request');
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
