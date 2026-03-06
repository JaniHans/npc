
export class Player {
    #username
    #skin
    constructor(username, skin) {
        this.#username = username;
        this.#skin = skin

    }

    get username() {
        return this.#username;
    }

    get skin() {
        return this.#skin;
    }
}