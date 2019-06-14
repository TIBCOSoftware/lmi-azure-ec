

exports.toFlatText = function(jsonNode, prefix) {
    let ret = "";
    if (prefix === undefined) {
        prefix = "";
    }

    if (Array.isArray(jsonNode)) {
        jsonNode.forEach(function (e, i) {
            if ((e === null) || (e === undefined)) {
                return;
            }
            let str = exports.toFlatText(e, prefix + "[" + i + "]");

            if (str !== null) {
                if (ret !== "") {
                    ret += ", ";
                }
                ret += str;
            }
        });
    }
    else if (jsonNode === null) {
        return prefix + "null";
    }
    else if (typeof jsonNode === "object") {
        for (let key of Object.keys(jsonNode)) {
            let value = jsonNode[key];

            let str = exports.toFlatText(value, prefix + ( prefix !== "" ? "." : "" ) + key);

            if (str !== null) {
                if (ret !== "") {
                    ret += ", ";
                }
                ret += str;

            }
        }
    }
    else {
        return prefix + "=" + JSON.stringify(jsonNode);
    }
    return ret;
}
