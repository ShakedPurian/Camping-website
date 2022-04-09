const mongoose= require('mongoose');
const Review = require('./review');
const Schema= mongoose.Schema;

const CampgroundSchema= new Schema({
    title: String,
    image: [{
        url: String,
        filename: String,
    }],
    price: Number,
    description: String,
    location: String,
    author:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviews: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Review'
    }],
    geometry: {
        type: {
            type: String,
            enum: ['Point'],
        },
        coordinates:{
            type: [Number],
        }
    }
});

CampgroundSchema.post('findOneAndDelete', async function(doc) {
    if(doc){
        await Review.remove({
            _id:{ $in: doc.reviews}
        })
    }
});

module.exports=mongoose.model('Campground', CampgroundSchema);




