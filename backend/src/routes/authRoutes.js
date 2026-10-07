const router = require('express').Router();
const { register, login, me, logout } = require('../controllers/authController');
const { requireAuth, loadUser } = require('../middleware/auth');

router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/auth/me', requireAuth, loadUser, me);
router.post('/auth/logout', requireAuth, loadUser, logout);

module.exports = router;
