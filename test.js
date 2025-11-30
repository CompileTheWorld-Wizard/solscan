var myHeaders = new Headers();
myHeaders.append("x-api-key", "C5WUfQxUvSmrEBES");

var requestOptions = {
  method: 'GET',
  headers: myHeaders,
  redirect: 'follow'
};

fetch("https://api.shyft.to/sol/v1/transaction/parsed?network=mainnet-beta&txn_signature=3fgjxx4w2eSazTySUiZZktqdXqpTxTCdi2UrUxdPKQWKhAWppEdCZHgMXJfkuPxfT8g3fNQ2BhNh69W4hAUujDZg", requestOptions)
  .then(response => response.text())
  .then(result => console.log(result))
  .catch(error => console.log('error', error));