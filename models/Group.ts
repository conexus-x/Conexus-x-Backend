import mongoose, { Document, Model, Schema } from "mongoose";


export interface IGroup extends Document {

    board: mongoose.Types.ObjectId;

    name: string;

    color?: string;

    position: number;

    createdBy: mongoose.Types.ObjectId;

    createdAt: Date;

    updatedAt: Date;

}



const GroupSchema = new Schema<IGroup>(
{

    board: {

        type: Schema.Types.ObjectId,

        ref: "Board",

        required: true,

        index: true,

    },


    name: {

        type: String,

        required: true,

        trim: true,

        maxlength:100,

    },


    color: {

        type:String,

        default:"#3B82F6",

    },


    position: {

        type:Number,

        default:0,

    },


    createdBy: {

        type:Schema.Types.ObjectId,

        ref:"User",

        required:true,

    },


},
{
    timestamps:true,
}
);



// Indexes

GroupSchema.index({
    board:1
});


GroupSchema.index({
    createdBy:1
});




const Group: Model<IGroup> =

mongoose.models.Group ||

mongoose.model<IGroup>(
    "Group",
    GroupSchema
);



export default Group;