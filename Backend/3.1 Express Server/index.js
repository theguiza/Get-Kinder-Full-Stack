import express from "express";
//import axios from "axios";
// then to use this axios.function 
const app = express(); 
const port = 3000; 

app.listen(port, () => {
    console.log(`Server is running on port ${port}.`);
}); 