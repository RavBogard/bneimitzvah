/**
 * A doubly-linked node within a hierarchical tree.
 * Supports both lateral traversal (siblings) and vertical traversal (parent-child).
 *
 * @template Self Type of the node's value.
 * @template Child Type of the nodes stored in the children array.
 * @template Parent Type of the parent node.
 */
export class Node {
    /** Next sibling in the sequence. */
    next = null;
    /** Previous sibling in the sequence. */
    prev = null;
    /** Node data. */
    value = null;
    /** Reference to the parent container. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parent = null;
    /** Collection of child nodes. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children = null;
    constructor() { }
    /**
     * Connects an array of nodes as a doubly-linked sibling chain starting after this node.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set siblings(arr) {
        const len = arr.length;
        for (let index = 0; index < len; index++) {
            const curr = arr[index];
            const nxt = arr[index + 1] || null;
            const prv = arr[index - 1] || this;
            curr.prev = prv;
            prv.next = curr;
            curr.next = nxt;
        }
    }
    /**
     * Retrieves all subsequent nodes in the current sibling chain.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get siblings() {
        let curr = this.next;
        const res = [];
        while (curr) {
            res.push(curr);
            curr = curr.next;
        }
        return res;
    }
}
//# sourceMappingURL=node.js.map