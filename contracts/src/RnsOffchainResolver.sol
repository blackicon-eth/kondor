// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RnsOffchainResolver
 * @notice CCIP-Read (EIP-3668) offchain resolver for RNS subdomains.
 *         Supports wildcard resolution (ENSIP-10) so that any
 *         `<username>.yourdomain.eth` query is routed to the gateway.
 */
contract RnsOffchainResolver {
    // ── Storage ──────────────────────────────────────────────────────────
    string public url;        // Gateway URL template, e.g. "https://gw.example.com/gateway/{sender}/{data}.json"
    address public signer;    // Public key that signs gateway responses
    address public owner;

    // ── EIP-3668 ─────────────────────────────────────────────────────────
    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    // ── EIP-165 interface IDs ────────────────────────────────────────────
    // IExtendedResolver.resolve(bytes,bytes)
    bytes4 private constant EXTENDED_RESOLVER_INTERFACE = 0x9061b923;
    // EIP-165
    bytes4 private constant EIP165_INTERFACE = 0x01ffc9a7;

    // ── Events ───────────────────────────────────────────────────────────
    event UrlChanged(string newUrl);
    event SignerChanged(address newSigner);
    event OwnerChanged(address newOwner);

    // ── Constructor ──────────────────────────────────────────────────────
    constructor(string memory _url, address _signer) {
        url = _url;
        signer = _signer;
        owner = msg.sender;
    }

    // ── Modifiers ────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Admin ────────────────────────────────────────────────────────────
    function setUrl(string calldata _url) external onlyOwner {
        url = _url;
        emit UrlChanged(_url);
    }

    function setSigner(address _signer) external onlyOwner {
        signer = _signer;
        emit SignerChanged(_signer);
    }

    function transferOwnership(address _owner) external onlyOwner {
        owner = _owner;
        emit OwnerChanged(_owner);
    }

    // ── ENSIP-10: Wildcard resolution ────────────────────────────────────
    /**
     * @dev Always reverts with OffchainLookup so the client fetches from the gateway.
     */
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory)
    {
        bytes memory callData = abi.encodeWithSelector(
            this.resolve.selector,
            name,
            data
        );

        string[] memory urls = new string[](1);
        urls[0] = url;

        revert OffchainLookup(
            address(this),
            urls,
            callData,
            this.resolveWithProof.selector,
            callData
        );
    }

    // ── CCIP-Read callback ───────────────────────────────────────────────
    /**
     * @dev Called by the client after fetching data from the gateway.
     *      Verifies the signer's signature and returns the result.
     *
     * response = abi.encode(bytes result, uint64 expires, bytes sig)
     * extraData = original callData (same as what the gateway received)
     */
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(
            response,
            (bytes, uint64, bytes)
        );

        require(block.timestamp <= expires, "Response expired");

        // Reconstruct the hash the gateway signed
        bytes32 requestHash = keccak256(extraData);
        bytes32 messageHash = keccak256(
            abi.encodePacked(result, address(this), expires, requestHash)
        );

        // Gateway uses EIP-191 personal_sign: "\x19Ethereum Signed Message:\n32" + hash
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                messageHash
            )
        );

        address recovered = _recover(ethSignedHash, sig);
        require(recovered == signer, "Invalid signer");

        return result;
    }

    // ── EIP-165 ──────────────────────────────────────────────────────────
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == EXTENDED_RESOLVER_INTERFACE ||
            interfaceId == EIP165_INTERFACE;
    }

    // ── Internal ─────────────────────────────────────────────────────────
    function _recover(bytes32 hash, bytes memory sig)
        internal
        pure
        returns (address)
    {
        require(sig.length == 65, "Bad sig length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }

        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Bad v value");

        return ecrecover(hash, v, r, s);
    }
}
