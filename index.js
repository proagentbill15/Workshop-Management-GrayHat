const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const { Sequelize, DataTypes } = require('sequelize');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { google } = require('googleapis');


const app = express();
app.use(bodyParser.json());


const sequelize = new Sequelize('workshop_db', 'username', 'password', {
  host: 'localhost',
  dialect: 'postgres',
});


const User = sequelize.define('User', {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('mentor', 'learner'), allowNull: false },
  notificationPreferences: { type: DataTypes.BOOLEAN, defaultValue: true },
});

const Workshop = sequelize.define('Workshop', {
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  mentorId: { type: DataTypes.INTEGER, allowNull: false },
  location: { type: DataTypes.STRING, allowNull: true },
  dateTime: { type: DataTypes.DATE, allowNull: false },
});

const Activity = sequelize.define('Activity', {
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  workshopId: { type: DataTypes.INTEGER, allowNull: false },
  dateTime: { type: DataTypes.DATE, allowNull: false },
});

const Enrollment = sequelize.define('Enrollment', {
  learnerId: { type: DataTypes.INTEGER, allowNull: false },
  workshopId: { type: DataTypes.INTEGER, allowNull: false },
});


User.hasMany(Workshop, { foreignKey: 'mentorId' });
Workshop.belongsTo(User, { foreignKey: 'mentorId' });
Workshop.hasMany(Activity, { foreignKey: 'workshopId' });
Activity.belongsTo(Workshop, { foreignKey: 'workshopId' });
Workshop.belongsToMany(User, { through: Enrollment, foreignKey: 'workshopId' });
User.belongsToMany(Workshop, { through: Enrollment, foreignKey: 'learnerId' });


const authenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).send('Access Denied');

  try {
    const verified = jwt.verify(token, 'SECRET_KEY');
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).send('Invalid Token');
  }
};

const authorize = (role) => (req, res, next) => {
  if (req.user.role !== role) return res.status(403).send('Access Forbidden');
  next();
};


const oauth2Client = new google.auth.OAuth2(
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'http://localhost:3000/oauth2callback'
);
google.options({ auth: oauth2Client });
const calendar = google.calendar('v3');


app.get('/auth/google', (req, res) => {
  const scopes = ['https://www.googleapis.com/auth/calendar'];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  res.json({ url });
});


app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  res.json({ message: 'Google Calendar connected successfully!' });
});


app.post('/workshops/:id/add-to-calendar', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const workshop = await Workshop.findByPk(id);

    if (!workshop) return res.status(404).send('Workshop Not Found');

    const event = {
      summary: workshop.title,
      location: workshop.location,
      description: workshop.description,
      start: {
        dateTime: workshop.dateTime,
        timeZone: 'UTC',
      },
      end: {
        dateTime: new Date(new Date(workshop.dateTime).getTime() + 2 * 60 * 60 * 1000).toISOString(),
        timeZone: 'UTC',
      },
    };

    const calendarEvent = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    res.status(201).json({ message: 'Workshop added to Google Calendar', event: calendarEvent.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/activities/:id/add-to-calendar', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const activity = await Activity.findByPk(id, { include: Workshop });

    if (!activity) return res.status(404).send('Activity Not Found');

    const event = {
      summary: activity.title,
      location: activity.Workshop.location,
      description: activity.description,
      start: {
        dateTime: activity.dateTime,
        timeZone: 'UTC',
      },
      end: {
        dateTime: new Date(new Date(activity.dateTime).getTime() + 1 * 60 * 60 * 1000).toISOString(),
        timeZone: 'UTC',
      },
    };

    const calendarEvent = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    res.status(201).json({ message: 'Activity added to Google Calendar', event: calendarEvent.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/workshops/:id/location', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const workshop = await Workshop.findByPk(id);

    if (!workshop) return res.status(404).send('Workshop Not Found');


    const googleMapsClient = require('@google/maps').createClient({
      key: 'GOOGLE_MAPS_API_KEY',
    });

    googleMapsClient.geocode({ address: workshop.location }, (err, response) => {
      if (!err) {
        res.json({ location: response.json.results });
      } else {
        res.status(500).json({ error: err.message });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Workshop Management API',
      version: '1.0.0',
      description: 'API for managing workshops, activities, and enrollments',
    },
  },
  apis: ['./index.js'],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Start Server
const PORT = 3000;
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await sequelize.sync({ force: true }); // Reset database for demo
  console.log('Database synced');
});
