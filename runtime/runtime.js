process.stderr.write(
"runtime start\n"
);


// ================================
// console
// ================================

global.console = {

    log(...args){
        process.stderr.write(
            "[log] "+
            args.join(" ")+"\n"
        );
    },

    warn(...args){
        process.stderr.write(
            "[warn] "+
            args.join(" ")+"\n"
        );
    },

    error(...args){
        process.stderr.write(
            "[error] "+
            args.join(" ")+"\n"
        );
    }

};



// ================================
// Headers
// ================================

class Headers {


    constructor(init={}){

        this.map={};


        if(init instanceof Headers){

            this.map={
                ...init.map
            };

        }


        else if(Array.isArray(init)){


            for(
                let item of init
            ){

                this.set(
                    item[0],
                    item[1]
                );

            }


        }


        else {


            for(
                let k in init
            ){

                this.set(
                    k,
                    init[k]
                );

            }

        }

    }



    get(name){

        return this.map[
            name.toLowerCase()
        ] ?? null;

    }



    set(name,value){

        this.map[
            name.toLowerCase()
        ]=
        String(value);

    }



    has(name){

        return (
            name.toLowerCase()
            in this.map
        );

    }



    delete(name){

        delete this.map[
            name.toLowerCase()
        ];

    }



    append(name,value){

        name=
        name.toLowerCase();


        if(this.map[name]){

            this.map[name]+=
            ", "+value;

        }

        else{

            this.map[name]=
            String(value);

        }

    }



    entries(){

        return Object.entries(
            this.map
        );

    }



    toJSON(){

        return this.map;

    }


}


global.Headers=Headers;



// ================================
// Request
// ================================


class Request {


    constructor(
        url,
        init={}
    ){


        this.url=
        String(url);


        this.method=
        (
            init.method ||
            "GET"
        ).toUpperCase();



        this.headers=
        init.headers instanceof Headers
        ?
        init.headers
        :
        new Headers(
            init.headers || {}
        );



        this.body=
        init.body || null;



        this.redirect=
        init.redirect ||
        "follow";


    }


}


global.Request=Request;




// ================================
// Response
// ================================


class Response {


    constructor(
        body="",
        init={}
    ){


        this.body=
        body ?? "";


        this.status=
        init.status || 200;



        this.headers=
        init.headers instanceof Headers
        ?
        init.headers
        :
        new Headers(
            init.headers || {}
        );



        this.ok=
        this.status>=200 &&
        this.status<300;


    }



    async text(){

        return String(
            this.body
        );

    }



    async json(){

        return JSON.parse(
            await this.text()
        );

    }



    static redirect(
        url,
        status=302
    ){

        return new Response(
            "",
            {

                status,

                headers:{
                    Location:url
                }

            }
        );

    }



    static json(
        data,
        init={}
    ){


        let headers=
        new Headers(
            init.headers || {}
        );


        headers.set(
            "content-type",
            "application/json"
        );



        return new Response(

            JSON.stringify(data),

            {

                ...init,

                headers

            }

        );

    }


}


global.Response=Response;



// ================================
// URL
// ================================

global.URL=URL;

global.URLSearchParams=
URLSearchParams;



// ================================
// env
// ================================


global.env={};



// ================================
// Worker Event
// ================================


let fetchHandler=null;


global.addEventListener=
function(type,handler){


    if(type==="fetch"){

        fetchHandler=
        handler;


        process.stderr.write(
            "fetch handler registered\n"
        );

    }

};



// ================================
// fetch bridge
// ================================


let fetchCounter=0;


let pendingFetch={};



global.fetch=function(
    url,
    options={}
){


    if(url instanceof Request){

        options={

            method:url.method,

            headers:url.headers,

            body:url.body

        };


        url=url.url;

    }



    let id=
    "fetch_"+
    (++fetchCounter);



    process.stdout.write(

        JSON.stringify({

            type:"fetch",

            id,

            url:String(url),

            method:
            options.method || "GET",

            headers:
            options.headers || {}

        })
        +"\n"

    );



    return new Promise(
        resolve=>{

            pendingFetch[id]=resolve;

        }

    );


};




// ================================
// stdin protocol
// ================================


process.stdin.on(
"data",
async chunk=>{


let lines=
chunk.toString()
.split("\n");



for(
let line of lines
){


if(!line.trim())
continue;



let msg;


try{

msg=
JSON.parse(line);

}
catch(e){

continue;

}




// HTTP request


if(msg.type==="request"){


process.stderr.write(
"request received\n"
);



let responseResolve;


let responsePromise=
new Promise(
r=>responseResolve=r
);



let event={


request:
new Request(
msg.url,
{

method:
msg.method,

headers:
msg.headers || {}

}

),



respondWith(
response
){


Promise.resolve(response)
.then(
res=>{

responseResolve(res);

}

);


}

};



await fetchHandler(event);



let res=
await responsePromise;



process.stdout.write(

JSON.stringify({

type:"response",

id:msg.id,

status:
res.status,

headers:
res.headers.toJSON(),

body:
res.body

})
+"\n"

);


}



// fetch 返回


else if(
msg.type==="fetch_response"
){


let fn=
pendingFetch[msg.id];


if(fn){


delete pendingFetch[msg.id];


fn(

new Response(

msg.body,

{

status:
msg.status,

headers:
msg.headers

}

)

);


}


}


}


});




// ================================
// Load worker
// ================================


require("./index.js");


process.stderr.write(
"index loaded\n"
);
