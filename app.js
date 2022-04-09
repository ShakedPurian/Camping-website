if (process.env.NODE_ENV !== "production"){
    require('dotenv').config()
}; //we use detenv npm to hide our cloudinary passwords. we get this ifo by process.env.CLOUDINARY...

const express= require('express');
const app= express();
const path= require('path');
const mongoose= require('mongoose');
const Campground= require('./models/campground');
const Review= require('./models/review');
const methodOverride= require('method-override');
const ejsMate= require ('ejs-mate');
const catchAsync= require('./utilities/catchAsync');
const ExpressError= require('./utilities/ExpressError');
const session= require ('express-session');
const flash= require('connect-flash');
const Joi= require('joi');
const passport= require('passport');
const localStrategy= require('passport-local');
const User= require('./models/user');
const multer= require('multer'); //to use uploaded imgs in forms
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const mbxGeocoding= require('@mapbox/mapbox-sdk/services/geocoding'); //maps
const mapBoxToken= process.env.MAPBOX_TOKEN;
const geocoder= mbxGeocoding({accessToken: mapBoxToken});  

cloudinary.config({  //online img storage
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
});
const storage= new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'campIL'
    }
});
const upload= multer({storage});

const MongoStore= require('connect-mongo'); //connecting our sessions to mongo
const dbUrl=process.env.DB_URL || 'mongodb://localhost:27017/campil';
mongoose.connect(dbUrl);
mongoose.connection.on("error", console.error.bind(console, "connection error"));
mongoose.connection.once("open", ()=>{
    console.log('DB connected')
});

app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// to use css files from styles directiory
app.use(express.static(path.join(__dirname, 'styles')));
// to be able to use put/post/delete requests: //
app.use(methodOverride('_method'));
// to be able to use post request body: //
app.use(express.urlencoded({extended: true}));

const secret= process.env.SECRET || 'secrettt' ;
const store = MongoStore.create({
    mongoUrl: dbUrl,
    touchAfter: 24 * 60 * 60,
    crypto: {
        secret
    }
});
const sessionConfig= {
    store, //store sessions on mongo (collection name- sessions)
    secret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        expires: Date.now() + 1000*60*60*24*7,
        maxAge: 1000*60*60*24*7
    }
};
app.use(session(sessionConfig));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new localStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req,res,next)=>{
    res.locals.currentUser= req.user;
    res.locals.success= req.flash('success');
    res.locals.error= req.flash('error');
    next();
});



//middleware to use in routs where a user should be signed in to use:
//req.authenticate checks if a user is logged in
const isLoggedIn= (req,res,next)=>{
    if (!req.isAuthenticated()){
        req.session.returnTo= req.originalUrl;
        req.flash('error', 'You must be signed in');
        return res.redirect('/campgrounds/login');
    }
    next();
}

app.get('/', (req,res)=>{
    res.render('home')
});

app.get('/contact', (req,res)=>{
    res.render('contact')
});

app.get('/campgrounds', catchAsync(async (req,res)=>{
    const campground= await Campground.find({});
    res.render('index', {campground}) 
}));

app.get('/campgrounds/new', isLoggedIn ,(req,res)=>{
    res.render('new')
});

app.post('/campgrounds', isLoggedIn, upload.array('campground[image]') ,catchAsync(async (req,res)=>{
    
    //using joi schema for validation: (if there is an error it will pass into expresserror and app.use at the ens will handle it//
    const campgroundSchema= Joi.object({
        campground: Joi.object({
            title: Joi.string().required(),
            price: Joi.number().required().min(0),
            description: Joi.string().required(),
            //image: Joi.string().required(),
            location: Joi.string().required(),
        }).required()
    })
    const {error}= campgroundSchema.validate(req.body);
    if (error) {
        //to take the error message out of the joi array respond:
        const msg= error.details.map(el => el.message).join(',');
        throw new ExpressError(msg, 400)
    } else {
        const geoData= await geocoder.forwardGeocode({
            query: req.body.campground.location,
            limit:1
        }).send(); //must use .send() for it to work!!
        const campground= new Campground(req.body.campground);
    campground.author= req.user._id;
    campground.image=req.files.map(f=>({url: f.path, filename: f.filename}));
    campground.geometry= geoData.body.features[0].geometry;
    await campground.save();
    res.redirect(`/campgrounds/${campground._id}`)
    };
}));

app.get('/campgrounds/register', (req,res)=>{
    res.render('register') 
});
app.post('/campgrounds/register', catchAsync(async (req,res,next)=>{
    try{
    const {email, username, password}= req.body;
    const user= new User({email, username});
    const registeredUser= await User.register(user, password);
    req.login(registeredUser, err =>{  //a call back here is mandatory for login to work
        if (err) return next (err);
        req.flash('success', 'Welcome!');
        res.redirect('/campgrounds');
    })
    } catch (e) {
        req.flash('error', e.message);
        res.redirect('/campgrounds/register');
    }
})); 

app.get('/campgrounds/login', (req,res)=>{
    res.render('login') 
});

app.post('/campgrounds/login', passport.authenticate('local', {failureRedirect: '/campgrounds/login', failureFlash: true}), (req,res)=>{
    req.flash('success', 'welcome back!');
    const redirecturl= req.session.returnTo || '/campgrounds';
    delete req.session.returnTo;
    res.redirect(redirecturl);
});

app.get('/logout', (req,res)=>{
    req.logOut();
    res.redirect('/campgrounds')
});

app.get('/campgrounds/:id', catchAsync(async(req,res,next)=>{
    try{
    const campground=await Campground.findById(req.params.id).populate('reviews').populate('author');
    res.render('details', {campground})
    } catch{
        next()
    }
}));

app.get('/campgrounds/:id/edit', isLoggedIn , catchAsync(async(req,res)=>{
    const {id}= req.params;
    const campground=await Campground.findById(id);
    if (!campground.author.equals(req.user._id)){
        req.flash('error', 'NO PERMISSION');
        return res.redirect(`/campgrounds/${id}`)
    }
    if (!campground){
        req.flash('error', 'campground is not found');
        return res.redirect('/campgrounds')
    }
    res.render('edit', {campground});
}));
app.put('/campgrounds/:id', isLoggedIn ,catchAsync(async(req,res)=>{
    const {id}= req.params;
    const campgroundSchema= Joi.object({
        campground: Joi.object({
            title: Joi.string().required(),
            price: Joi.number().required().min(0),
            description: Joi.string().required(),
            //image: Joi.string().required(),
            location: Joi.string().required(),
        }).required()
    })
    const {error}= campgroundSchema.validate(req.body);
    if (error) {
        //to take the error message out of the joi array respond:
        const msg= error.details.map(el => el.message).join(',');
        throw new ExpressError(msg, 400)
    } else {
        const camp= await Campground.findById(id);
    if (!camp.author.equals(req.user._id)){
        req.flash('error', 'NO PERMISSION');
        return res.redirect(`/campgrounds/${id}`)
    } else{
        const campground= await Campground.findByIdAndUpdate(id, {...req.body.campground});
    res.redirect(`/campgrounds/${campground._id}`)
    }};
}));

app.delete('/campgrounds/:id', isLoggedIn , catchAsync(async (req,res)=>{
    const {id}= req.params;
    const campground=await Campground.findById(id);
    if (!campground.author.equals(req.user._id)){
        req.flash('error', 'NO PERMISSION');
        return res.redirect(`/campgrounds/${id}`)
    } else{
        await Campground.findByIdAndDelete(id);
        for (let image of campground.image){
            await cloudinary.uploader.destroy(image.filename)
        };
    res.redirect('/campgrounds');
    }
}));

//reviews:
app.post('/campgrounds/:id/reviews', isLoggedIn , catchAsync(async (req,res)=>{
    const campground= await Campground.findById(req.params.id);
    const review= new Review(req.body.review);
    campground.reviews.push(review);
    await review.save();
    await campground.save();
    res.redirect(`/campgrounds/${campground._id}`);
}));

app.delete('/campgrounds/:id/reviews/:reviewId', isLoggedIn , catchAsync(async (req,res)=>{
    const { id, reviewId }= req.params;
    await Campground.findByIdAndUpdate(id, {$pull:{reviews: reviewId}}); //<<to take the review out of the camp
    await Review.findByIdAndDelete(reviewId);
    res.redirect(`/campgrounds/${id}`);
}));

//if none of paths above matched, this will be the response: //
app.all('*', (req, res, next)=>{
    next(new ExpressError('page not found', 404))
});

app.use((err,req,res,next)=>{
    const {statusCode = 500}= err;
    if (!err.message) err.message = 'ERROR- something went wrong!';
    res.status(statusCode).render('error.ejs', {err});
});

const port= process.env.PORT || 3000
app.listen(port,()=>{
    console.log('serving on port')
});
