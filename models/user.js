const mongoose= require ('mongoose');
const passportLocalMongoose= require('passport-local-mongoose');

const userSchema= new mongoose.Schema({
    email:{
        type: String,
        required: true,
        unique: true
    }
});

userSchema.plugin(passportLocalMongoose); //adds username&password to the schema and makes sure they are unique

module.exports= mongoose.model('User', userSchema);

