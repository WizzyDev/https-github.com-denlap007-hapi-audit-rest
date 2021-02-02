const Hapi = require("@hapi/hapi");
const Lab = require("@hapi/lab");
const { expect } = require("@hapi/code");

const plugin = require("../lib/index");

const { describe, it, before, after, afterEach } = (exports.lab = Lab.script());

const internals = {};

internals.implmentation = (server, options) => {
    const scheme = {
        authenticate: (request, h) => {
            const credentials = {
                userName: "user",
            };
            return h.authenticated({ credentials });
        },
    };

    return scheme;
};

internals.constants = {
    GET_ALL: "GET all",
    GET_BY_ID: "GET by id",
};

internals.authInitialization = (server) => {
    server.auth.scheme("custom", internals.implmentation);
    server.auth.strategy("default", "custom", { name: "sid" });
    server.auth.default("default");
};

describe("test basic GET, POST, PUT flows", () => {
    const server = Hapi.server();
    let auditError = null;
    let auditEvent = null;

    before(async () => {
        server.route({
            method: "GET",
            path: "/api/test",
            handler: (request, h) => internals.constants.GET_ALL,
        });
        server.route({
            method: "GET",
            path: "/api/test/{id}",
            handler: (request, h) => internals.constants.GET_BY_ID,
        });
        server.route({
            method: "POST",
            path: "/api/test",
            handler: (request, h) => ({ id: 10, ...request.payload }),
        });

        internals.authInitialization(server);

        await server.register([
            {
                plugin,
                options: {
                    sidUsernameAttribute: "userName",
                },
            },
        ]);

        server.events.on({ name: "request", channels: "app" }, (request, event, tags) => {
            if (tags.error && tags["hapi-audit-rest"]) {
                auditError = event;
            }
        });

        server.events.on("hapi-audit-rest", (data) => {
            auditEvent = data;
        });
        await server.start();
    });

    after(async () => {
        await server.stop();
    });

    afterEach(() => {
        auditError = null;
        auditEvent = null;
    });

    it("GET all, should emit an audit action event", async () => {
        const res = await server.inject({
            method: "get",
            url: "/api/test",
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result).to.equal(internals.constants.GET_ALL);

        expect(auditError).to.equal(null);

        expect(auditEvent).to.part.include({
            application: "my-app",
            type: "SEARCH",
            body: {
                entity: "test",
                entityId: undefined,
                action: "SEARCH",
                username: "user",
                data: {},
            },
            outcome: "Success",
        });
    });

    it("GET by id, should emit an audit action event", async () => {
        const res = await server.inject({
            method: "get",
            url: "/api/test/5",
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result).to.equal(internals.constants.GET_BY_ID);

        expect(auditError).to.equal(null);

        expect(auditEvent).to.part.include({
            application: "my-app",
            type: "SEARCH",
            body: {
                entity: "test",
                entityId: "5",
                action: "SEARCH",
                username: "user",
                data: {},
            },
            outcome: "Success",
        });
    });

    it("POST, should emit an audit mutation event", async () => {
        const payload = { a: "a", b: "b", c: "c" };
        const res = await server.inject({
            method: "post",
            payload,
            url: "/api/test",
        });

        expect(res.statusCode).to.equal(200);
        expect(res.result).to.equal({ id: 10, ...payload });

        expect(auditError).to.equal(null);

        expect(auditEvent).to.part.include({
            application: "my-app",
            type: "MUTATION",
            body: {
                entity: "test",
                entityId: 10,
                action: "CREATE",
                username: "user",
                originalValues: {},
                newValues: {
                    id: 10,
                    a: "a",
                    b: "b",
                    c: "c",
                },
            },
            outcome: "Success",
        });
    });
});
